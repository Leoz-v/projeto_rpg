import { rollAbilityScores, rollDice, type Rng, type Size, spaceSquares, usesRolledValues } from 'rules-engine';
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
  type SessionCharacter,
  type SessionState,
  type Token,
  MAX_INVENTORY_ITEMS,
  MAX_ITEM_QUANTITY,
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
  /** Tira dos passos as seleções que nenhuma escolha usa mais (`pruneSelections` do motor, com o compêndio). */
  pruneSteps(steps: SessionCharacter['steps']): SessionCharacter['steps'];
  /** Problemas de uma entrada nova do inventário (`inventoryEntryProblems` do motor); vazio = pode entrar. */
  itemProblems(entry: { itemId: string; baseItemId?: string | undefined; variantId?: string | undefined }): string[];
}

type InventoryEntry = SessionCharacter['inventory']['items'][number];
const EMPTY_INVENTORY: SessionCharacter['inventory'] = { currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 }, items: [] };

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
      characters: restored?.characters ?? {},
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
      case 'character.create':
        return this.createCharacter(playerId, role, intent.data);
      case 'character.update':
        return this.updateCharacter(playerId, role, intent.data);
      case 'character.roll_scores':
        return this.rollScores(playerId, role, intent.data.characterId);
      case 'character.remove':
        return this.removeCharacter(playerId, role, intent.data.characterId);
      case 'inventory.add':
        return this.addItem(playerId, role, intent.data);
      case 'inventory.remove':
        return this.removeItem(playerId, role, intent.data);
      case 'inventory.update':
        return this.updateItem(playerId, role, intent.data);
      case 'inventory.currency':
        this.ownCharacter(playerId, role, intent.data.characterId);
        return [{ op: 'replace', path: toPointer('characters', intent.data.characterId, 'inventory', 'currency'), value: intent.data.currency }];
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
    if (data.characterId !== undefined && this.current.characters[data.characterId] === undefined) throw violation('Personagem não encontrado');
    const token: Token = {
      id: this.deps.newId(),
      mapId: data.mapId,
      name: data.name,
      position: data.position,
      size: data.size,
      monsterId: data.monsterId ?? null,
      image: data.image ?? null,
      ownerIds,
      characterId: data.characterId ?? null,
    };
    return [{ op: 'add', path: toPointer('tokens', token.id), value: token }];
  }

  /** O personagem, se quem pede é o dono ou o mestre. */
  private ownCharacter(playerId: string, role: Role, characterId: string): SessionCharacter {
    const character = this.current.characters[characterId];
    if (!character) throw violation('Personagem não encontrado');
    if (role !== 'gm' && character.ownerId !== playerId) throw notAllowed('Este personagem não é seu');
    return character;
  }

  private createCharacter(playerId: string, role: Role, data: IntentData<'character.create'>): PatchOp[] {
    const ownerId = data.ownerId ?? playerId;
    if (ownerId !== playerId) {
      this.requireGm(role);
      if (this.current.players[ownerId] === undefined) throw violation('Dono do personagem não está na mesa');
    }
    const character: SessionCharacter = { id: this.deps.newId(), ownerId, name: data.name, baseScores: null, rolledScores: null, steps: [], inventory: EMPTY_INVENTORY };
    return [{ op: 'add', path: toPointer('characters', character.id), value: character }];
  }

  /**
   * Troca nome, atributos ou passos de construção. O Host confere só a
   * estrutura e a origem dos atributos: a construção pode estar incompleta
   * (rascunho), e o motor aponta o que falta na ficha.
   */
  private updateCharacter(playerId: string, role: Role, data: IntentData<'character.update'>): PatchOp[] {
    const character = this.ownCharacter(playerId, role, data.characterId);
    const ops: PatchOp[] = [];
    const set = (field: 'name' | 'baseScores' | 'steps', value: unknown): void => {
      ops.push({ op: 'replace', path: toPointer('characters', character.id, field), value });
    };
    if (data.name !== undefined) set('name', data.name);
    if (data.baseScores !== undefined) {
      const { method, scores } = data.baseScores;
      if (method === 'manual' && role !== 'gm') throw notAllowed('Só o mestre pode definir atributos à mão');
      if (method === 'rolled' && (character.rolledScores === null || !usesRolledValues(scores, character.rolledScores))) {
        throw violation('Os atributos precisam usar os valores rolados pelo Host');
      }
      set('baseScores', data.baseScores);
    }
    // Desfazer uma escolha deixa soltas as seleções de dentro dela: o Host as descarta.
    if (data.steps !== undefined) set('steps', this.deps.pruneSteps(data.steps));
    return ops;
  }

  /**
   * O Host rola os atributos (4d6, descarta o menor, seis vezes) e publica no
   * chat. O dono rola uma vez; o mestre pode mandar rolar de novo, o que
   * desfaz uma distribuição feita com os valores antigos.
   */
  private rollScores(playerId: string, role: Role, characterId: string): PatchOp[] {
    const character = this.ownCharacter(playerId, role, characterId);
    if (character.rolledScores !== null && role !== 'gm') throw notAllowed('Os atributos já foram rolados; peça ao mestre para rolar de novo');
    const sets = rollAbilityScores(this.deps.rng);
    const ops: PatchOp[] = [
      { op: 'replace', path: toPointer('characters', character.id, 'rolledScores'), value: sets.map((s) => s.total) },
      this.appendChat({ kind: 'ability_roll', ...this.entryBase(playerId), characterId: character.id, characterName: character.name, sets }),
    ];
    if (character.baseScores?.method === 'rolled') ops.push({ op: 'replace', path: toPointer('characters', character.id, 'baseScores'), value: null });
    return ops;
  }

  /** Remove o personagem; os tokens dele continuam no mapa, sem a ligação. */
  private removeCharacter(playerId: string, role: Role, characterId: string): PatchOp[] {
    this.ownCharacter(playerId, role, characterId);
    const unlink = Object.values(this.current.tokens)
      .filter((t) => t.characterId === characterId)
      .map((t): PatchOp => ({ op: 'replace', path: toPointer('tokens', t.id, 'characterId'), value: null }));
    return [...unlink, { op: 'remove', path: toPointer('characters', characterId) }];
  }

  private entry(character: SessionCharacter, instanceId: string): { entry: InventoryEntry; index: number } {
    const index = character.inventory.items.findIndex((e) => e.instanceId === instanceId);
    const entry = character.inventory.items[index];
    if (!entry) throw violation('Item não encontrado no inventário');
    return { entry, index };
  }

  /**
   * Item do compêndio para o inventário. O motor confere o item, a variante e
   * o item base. Uma entrada igual que não está vestida nem sintonizada só
   * ganha quantidade (20 flechas + 20 flechas = 40 flechas).
   */
  private addItem(playerId: string, role: Role, data: IntentData<'inventory.add'>): PatchOp[] {
    const character = this.ownCharacter(playerId, role, data.characterId);
    const problems = this.deps.itemProblems(data);
    if (problems.length > 0) throw violation(problems[0] ?? 'Item inválido');
    const quantity = data.quantity ?? 1;
    const items = character.inventory.items;
    const same = items.findIndex(
      (e) => e.itemId === data.itemId && e.baseItemId === data.baseItemId && e.variantId === data.variantId && !e.equipped && !e.attuned,
    );
    const existing = items[same];
    if (existing) {
      const total = existing.quantity + quantity;
      if (total > MAX_ITEM_QUANTITY) throw violation(`No máximo ${MAX_ITEM_QUANTITY} unidades por item`);
      return [{ op: 'replace', path: toPointer('characters', character.id, 'inventory', 'items', String(same), 'quantity'), value: total }];
    }
    if (items.length >= MAX_INVENTORY_ITEMS) throw violation(`No máximo ${MAX_INVENTORY_ITEMS} itens no inventário`);
    const entry: InventoryEntry = {
      instanceId: this.deps.newId(),
      itemId: data.itemId,
      ...(data.baseItemId !== undefined ? { baseItemId: data.baseItemId } : {}),
      ...(data.variantId !== undefined ? { variantId: data.variantId } : {}),
      quantity,
      equipped: false,
      attuned: false,
    };
    return [{ op: 'add', path: toPointer('characters', character.id, 'inventory', 'items', '-'), value: entry }];
  }

  /** Tira `quantity` unidades (padrão: a entrada inteira). */
  private removeItem(playerId: string, role: Role, data: IntentData<'inventory.remove'>): PatchOp[] {
    const character = this.ownCharacter(playerId, role, data.characterId);
    const { entry, index } = this.entry(character, data.instanceId);
    const path = toPointer('characters', character.id, 'inventory', 'items', String(index));
    if (data.quantity !== undefined && data.quantity < entry.quantity) return [{ op: 'replace', path: `${path}/quantity`, value: entry.quantity - data.quantity }];
    return [{ op: 'remove', path }];
  }

  /**
   * Vestir, sintonizar ou mudar a quantidade. Regras que dependem da ficha
   * (uma armadura por vez, limite de sintonização, quem pode sintonizar) o
   * motor aponta na ficha, sem bloquear: o mestre decide.
   */
  private updateItem(playerId: string, role: Role, data: IntentData<'inventory.update'>): PatchOp[] {
    const character = this.ownCharacter(playerId, role, data.characterId);
    const { index } = this.entry(character, data.instanceId);
    const path = toPointer('characters', character.id, 'inventory', 'items', String(index));
    const ops: PatchOp[] = [];
    if (data.equipped !== undefined) ops.push({ op: 'replace', path: `${path}/equipped`, value: data.equipped });
    if (data.attuned !== undefined) ops.push({ op: 'replace', path: `${path}/attuned`, value: data.attuned });
    if (data.quantity !== undefined) ops.push({ op: 'replace', path: `${path}/quantity`, value: data.quantity });
    return ops;
  }
}
