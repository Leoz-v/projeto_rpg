import { rollDice, type Rng, type Size, spaceSquares } from 'rules-engine';
import type { z } from 'zod';
import {
  applyPatch,
  type ChatEntry,
  type GameMap,
  type Intent,
  type IntentData,
  type IntentRejectCode,
  type IntentResultSchema,
  type PatchOp,
  type Point,
  type Role,
  type SessionState,
  type Token,
  toPointer,
  WORLD_UNITS_PER_CELL,
} from '../../shared/protocol';
import { opsFor, viewOf } from './visibility';

/**
 * Executor da sessão do Host: recebe `Intent` de quem já passou pelo
 * handshake, confere permissões e regras, aplica a mudança e devolve o patch.
 * Não faz I/O: a rede (PR 3) e o IPC (PR 4) só entregam e transmitem.
 * Nunca lança: erro inesperado vira `internal_error` e o estado não muda.
 */

export type IntentResultPayload = z.infer<typeof IntentResultSchema>['payload'];

export interface SessionDeps {
  rng: Rng;
  /** Epoch em ms. */
  now(): number;
  /** UUID para mapas, tokens e entradas do chat. */
  newId(): string;
  /** O id existe entre as criaturas do compêndio. */
  monsterExists(id: string): boolean;
  /** O Host tem o asset (imagem de fundo ou de token). */
  assetExists(sha256: string): boolean;
}

/** Uma revisão do estado, na visão do mestre (o transporte filtra com `patchFor`). */
export interface StateChange {
  rev: number;
  baseRev: number;
  ops: PatchOp[];
}

export interface IntentOutcome {
  result: IntentResultPayload;
  /** Presente quando o estado mudou: transmitir a todos com `patchFor`. */
  change?: StateChange;
  /** `session.resync`: mandar um `StateSnapshot` só para quem pediu. */
  resync?: boolean;
}

export interface Identity {
  playerId: string;
  displayName: string;
}

class Rejection extends Error {
  constructor(
    readonly code: IntentRejectCode,
    message: string,
  ) {
    super(message);
  }
}

const notAllowed = (message: string): Rejection => new Rejection('not_allowed', message);
const violation = (message: string): Rejection => new Rejection('rule_violation', message);

export class HostSession {
  private current: SessionState;
  private revision = 0;

  /**
   * `restored`: o estado salvo da campanha (`<campanha>.db`). Ninguém começa
   * conectado além do mestre, e só o mestre desta sessão tem o papel `gm`
   * (o arquivo é portátil e pode ter sido hospedado por outra pessoa).
   */
  constructor(
    campaign: SessionState['campaign'],
    private readonly gm: Identity,
    private readonly deps: SessionDeps,
    restored?: SessionState,
  ) {
    const players = Object.fromEntries(
      Object.entries(restored?.players ?? {}).map(([id, p]) => [id, { displayName: p.displayName, role: 'player' as const, connected: false }]),
    );
    this.current = {
      campaign: restored?.campaign ?? campaign,
      players: { ...players, [gm.playerId]: { displayName: gm.displayName, role: 'gm', connected: true } },
      chat: restored?.chat ?? [],
      maps: restored?.maps ?? {},
      activeMapId: restored?.activeMapId ?? null,
      tokens: restored?.tokens ?? {},
    };
  }

  get rev(): number {
    return this.revision;
  }

  /** Estado completo (visão do mestre). */
  get state(): SessionState {
    return this.current;
  }

  roleOf(playerId: string): Role | undefined {
    return this.current.players[playerId]?.role;
  }

  isConnected(playerId: string): boolean {
    return this.current.players[playerId]?.connected === true;
  }

  /** O snapshot para um jogador. */
  viewFor(playerId: string): SessionState {
    return viewOf(this.current, { playerId, role: this.roleOf(playerId) ?? 'player' });
  }

  /** O patch para um jogador: mesmo `rev`, operações filtradas (podem ficar vazias). */
  patchFor(change: StateChange, playerId: string): StateChange {
    return { ...change, ops: opsFor(change.ops, { playerId, role: this.roleOf(playerId) ?? 'player' }) };
  }

  /** Conexão aceita no handshake: registra o jogador ou o marca como conectado. */
  connect(identity: Identity): StateChange {
    const known = this.current.players[identity.playerId];
    const role: Role = identity.playerId === this.gm.playerId ? 'gm' : (known?.role ?? 'player');
    return this.commit([{ op: 'add', path: toPointer('players', identity.playerId), value: { displayName: identity.displayName, role, connected: true } }]);
  }

  /** Conexão caiu. Sem mudança se o jogador não estava conectado. */
  disconnect(playerId: string): StateChange | undefined {
    if (!this.isConnected(playerId)) return undefined;
    return this.commit([{ op: 'replace', path: toPointer('players', playerId, 'connected'), value: false }]);
  }

  handle(playerId: string, intent: Intent): IntentOutcome {
    try {
      const role = this.roleOf(playerId);
      if (!role || !this.isConnected(playerId)) throw notAllowed('Jogador não está na mesa');
      if (intent.kind === 'session.resync') return { result: { status: 'applied', rev: this.revision }, resync: true };
      const change = this.commit(this.opsFor(playerId, role, intent));
      return { result: { status: 'applied', rev: change.rev }, change };
    } catch (err: unknown) {
      if (err instanceof Rejection) return { result: { status: 'rejected', code: err.code, message: err.message } };
      return { result: { status: 'rejected', code: 'internal_error', message: 'Erro interno do Host' } };
    }
  }

  private commit(ops: PatchOp[]): StateChange {
    // Aplica antes de mudar a revisão: se o patch falhar, nada muda.
    this.current = applyPatch(this.current, ops);
    const baseRev = this.revision;
    this.revision += 1;
    return { rev: this.revision, baseRev, ops };
  }

  private opsFor(playerId: string, role: Role, intent: Exclude<Intent, { kind: 'session.resync' }>): PatchOp[] {
    switch (intent.kind) {
      case 'chat.message':
        return [this.appendChat({ kind: 'message', ...this.entryBase(playerId), text: intent.data.text })];
      case 'dice.roll':
        return [this.appendChat(this.roll(playerId, intent.data))];
      case 'token.move':
        return this.moveToken(playerId, role, intent.data);
      case 'map.create':
        this.requireGm(role);
        return this.createMap(intent.data);
      case 'map.activate':
        this.requireGm(role);
        this.map(intent.data.mapId);
        return [{ op: 'replace', path: '/activeMapId', value: intent.data.mapId }];
      case 'token.create':
        this.requireGm(role);
        return this.createToken(intent.data);
      case 'token.remove':
        this.requireGm(role);
        this.token(intent.data.tokenId);
        return [{ op: 'remove', path: toPointer('tokens', intent.data.tokenId) }];
    }
  }

  private requireGm(role: Role): void {
    if (role !== 'gm') throw notAllowed('Só o mestre pode fazer isso');
  }

  private map(mapId: string): GameMap {
    const map = this.current.maps[mapId];
    if (!map) throw violation('Mapa não encontrado');
    return map;
  }

  private token(tokenId: string): Token {
    const token = this.current.tokens[tokenId];
    if (!token) throw violation('Token não encontrado');
    return token;
  }

  /** O token inteiro precisa caber no mapa: canto em `p` mais o espaço do tamanho (SRD: Large ocupa 2×2). */
  private requireInside(map: GameMap, p: Point, size: Size): void {
    const side = spaceSquares(size) * WORLD_UNITS_PER_CELL;
    if (p.x + side > map.width * WORLD_UNITS_PER_CELL || p.y + side > map.height * WORLD_UNITS_PER_CELL) throw violation('Posição fora do mapa');
  }

  private entryBase(playerId: string): Pick<ChatEntry, 'id' | 'at' | 'authorId'> {
    return { id: this.deps.newId(), at: this.deps.now(), authorId: playerId };
  }

  private appendChat(entry: ChatEntry): PatchOp {
    return { op: 'add', path: '/chat/-', value: entry };
  }

  private roll(playerId: string, data: IntentData<'dice.roll'>): ChatEntry {
    const result = rollDice(data.formula, this.deps.rng);
    return {
      kind: 'roll',
      ...this.entryBase(playerId),
      formula: data.formula,
      ...(data.label !== undefined ? { label: data.label } : {}),
      visibility: data.visibility,
      rolls: result.rolls.map((r) => ({ sides: r.sides, value: r.value })),
      total: result.total,
    };
  }

  private moveToken(playerId: string, role: Role, data: IntentData<'token.move'>): PatchOp[] {
    const token = this.token(data.tokenId);
    if (role !== 'gm' && !token.ownerIds.includes(playerId)) throw notAllowed('Você não controla este token');
    this.requireInside(this.map(token.mapId), data.to, token.size);
    return [{ op: 'replace', path: toPointer('tokens', token.id, 'position'), value: data.to }];
  }

  private requireAsset(sha256: string | undefined): void {
    if (sha256 !== undefined && !this.deps.assetExists(sha256)) throw violation('Imagem não encontrada no Host');
  }

  private createMap(data: IntentData<'map.create'>): PatchOp[] {
    this.requireAsset(data.background);
    if (data.cellPx !== undefined && data.background === undefined) throw violation('Tamanho de célula em pixels exige imagem de fundo');
    const map: GameMap = {
      id: this.deps.newId(),
      name: data.name,
      width: data.width,
      height: data.height,
      background: data.background ?? null,
      cellPx: data.cellPx ?? null,
    };
    const ops: PatchOp[] = [{ op: 'add', path: toPointer('maps', map.id), value: map }];
    if (this.current.activeMapId === null) ops.push({ op: 'replace', path: '/activeMapId', value: map.id });
    return ops;
  }

  private createToken(data: IntentData<'token.create'>): PatchOp[] {
    this.requireInside(this.map(data.mapId), data.position, data.size);
    if (data.monsterId !== undefined && !this.deps.monsterExists(data.monsterId)) throw violation('Monstro não encontrado no compêndio');
    this.requireAsset(data.image);
    const ownerIds = [...new Set(data.ownerIds ?? [])];
    if (ownerIds.some((id) => this.current.players[id] === undefined)) throw violation('Dono do token não está na mesa');
    const token: Token = {
      id: this.deps.newId(),
      mapId: data.mapId,
      name: data.name,
      position: data.position,
      size: data.size,
      monsterId: data.monsterId ?? null,
      image: data.image ?? null,
      ownerIds,
    };
    return [{ op: 'add', path: toPointer('tokens', token.id), value: token }];
  }
}
