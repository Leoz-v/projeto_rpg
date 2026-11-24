import {
  type Ability,
  applyDamage,
  applyHitPointChange,
  attackedConditions,
  cleaveDamageBonus,
  conditionDefenses,
  creatureD20,
  clampHitPoints,
  type Condition,
  CONDITION_NAME,
  type Creature,
  creatureDefenses,
  creatureSaveBonus,
  currentHitPoints,
  type D20RollInput,
  d20Mode,
  d20StepNotes,
  damageNotes,
  type DamageType,
  type Defenses,
  type DerivedSheet,
  distanceFeet,
  effectiveConditions,
  expiresAt,
  deathAfterDamage,
  deathAfterHealing,
  type DeathSaveState,
  grazeDamage,
  type HitPointChange,
  type HitPointResult,
  isDying,
  resolveDeathSave,
  concentrationDc,
  NO_DEATH_SAVES,
  isBloodied,
  MASTERY_NAME,
  masteryOutcome,
  nextTurn,
  nextTurnRound,
  previousTurn,
  resolveAttack,
  resolveSave,
  type Rng,
  rollAbilityScores,
  rollActionDamage,
  type RollAgainst,
  rollD20,
  rollDice,
  rollWeaponDamage,
  sheetD20,
  type SheetD20,
  type Size,
  sortByInitiative,
  spaceSquares,
  TIMED_MASTERY_UNTIL,
  timedMastery,
  timedMasteryNote,
  toppleDc,
  type TriggerMoment,
  type TurnExpiry,
  turnAfterRemoval,
  usesRolledValues,
} from 'rules-engine';
import type { z } from 'zod';
import {
  applyPatch,
  chatBefore,
  type ChatEntry,
  chatWindow,
  type Combat,
  type ConditionState,
  NO_CONDITIONS,
  type TimedEffect,
  type TableCondition,
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
  MAX_ADJUSTMENTS,
  MAX_TURN_TRIGGER_ITEMS,
  MAX_COMBATANTS,
  MAX_EXHAUSTION_LEVEL,
  MAX_INITIATIVE,
  MAX_INVENTORY_ITEMS,
  MAX_ITEM_QUANTITY,
  MIN_INITIATIVE,
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
  /** Ficha calculada pelo motor; `undefined` sem ficha (atributos não definidos). */
  characterSheet(character: SessionCharacter): DerivedSheet | undefined;
  /** PV médios do bloco de estatísticas de um monstro do compêndio. */
  monsterHpMax(monsterId: string): number | undefined;
  /** Bloco de estatísticas de um monstro do compêndio. */
  creature(monsterId: string): Creature | undefined;
  /** Nome de uma magia do compêndio (para o chat da Concentração). */
  spellName(spellId: string): string | undefined;
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
      proposals: {},
      combat: restored?.combat ?? null,
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

  /** O `StateSnapshot` desse jogador: o estado visível com a janela do chat (nota 0047). */
  snapshotFor(playerId: string): { state: SessionState; chatFrom: number } {
    const { state, chatFrom } = chatWindow(this.current);
    return { state: viewOf(state, { playerId, role: this.roleOf(playerId) ?? 'player' }), chatFrom };
  }

  /** Entradas do chat antes de `before`, filtradas para esse jogador (`ChatHistoryRequest`). */
  chatHistory(playerId: string, before: number, limit: number): { from: number; entries: ChatEntry[] } {
    const { from, entries } = chatBefore(this.current.chat, before, limit);
    const view = viewOf({ ...this.current, chat: entries }, { playerId, role: this.roleOf(playerId) ?? 'player' });
    return { from, entries: view.chat };
  }

  /** O patch para um jogador: mesmo `rev`, operações filtradas (podem ficar vazias). */
  patchFor(change: StateChange, playerId: string): StateChange {
    return { ...change, ops: opsFor(change.ops, { playerId, role: this.roleOf(playerId) ?? 'player' }, this.current) };
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
        return [{ op: 'remove', path: toPointer('tokens', intent.data.tokenId) }, ...this.leaveCombat(playerId, intent.data.tokenId)];
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
      case 'adjustment.add':
        this.requireGm(role);
        return this.addAdjustment(playerId, role, intent.data);
      case 'adjustment.remove': {
        this.requireGm(role);
        const character = this.ownCharacter(playerId, role, intent.data.characterId);
        const index = character.adjustments.findIndex((a) => a.id === intent.data.adjustmentId);
        if (index < 0) throw violation('Ajuste não encontrado');
        return [{ op: 'remove', path: toPointer('characters', character.id, 'adjustments', String(index)) }];
      }
      case 'roll.d20': {
        // Salvaguarda contra a Morte de quem está morrendo conta (fora do combate; no combate, o Host rola no início do turno).
        if (intent.data.target.kind === 'death_save') {
          const { character, sheet } = this.sheetOf(playerId, role, intent.data.characterId);
          if (isDying(currentHitPoints(sheet.hpMax.total, character.hp), character.deathSaves)) {
            if (this.inCombat(character.id)) throw violation('No combate, o Host rola a Salvaguarda contra a Morte no início do turno');
            return this.rollDeathSave(playerId, this.current, character.id);
          }
        }
        return [this.appendChat(this.rollFromSheet(playerId, role, intent.data))];
      }
      case 'death.set': {
        this.requireGm(role);
        const character = this.current.characters[intent.data.characterId];
        if (!character) throw violation('Personagem não encontrado');
        return [
          { op: 'replace', path: toPointer('characters', character.id, 'deathSaves'), value: intent.data.deathSaves },
          this.deathStateEntry(playerId, character, 'gm', intent.data.deathSaves, ['Ajuste do mestre']),
          ...this.concentrationBreaks(playerId, character, character.conditions, intent.data.deathSaves),
        ];
      }
      case 'concentration.set':
        return this.concentrate(playerId, role, intent.data.characterId, intent.data.spellId);
      case 'concentration.end': {
        const character = this.ownCharacter(playerId, role, intent.data.characterId);
        if (!character.concentration) throw violation(`${character.name} não está concentrado`);
        return this.endConcentration(playerId, character, 'ended');
      }
      case 'roll.damage':
        return [this.appendChat(this.rollDamage(playerId, role, intent.data))];
      case 'attack.make':
        return this.makeAttack(playerId, role, intent.data);
      case 'save.force':
        return this.forceSave(playerId, role, intent.data);
      case 'mastery.use':
        return this.useMastery(playerId, role, intent.data);
      case 'combat.start':
        this.requireGm(role);
        return this.startCombat(playerId, intent.data);
      case 'combat.add':
        this.requireGm(role);
        return this.joinCombat(playerId, intent.data);
      case 'combat.remove':
        this.requireGm(role);
        this.combatant(intent.data.tokenId);
        return this.leaveCombat(playerId, intent.data.tokenId);
      case 'combat.set_initiative':
        this.requireGm(role);
        return this.setInitiative(intent.data.tokenId, intent.data.initiative);
      case 'combat.next':
        return this.nextTurn(playerId, role);
      case 'combat.previous': {
        this.requireGm(role);
        const combat = this.combat();
        const position = previousTurn(combat, combat.combatants.length);
        return [this.replaceCombat({ ...combat, ...position })];
      }
      case 'combat.end': {
        this.requireGm(role);
        const combat = this.combat();
        // As durações por turno não fazem sentido fora do combate: terminam todas.
        const expired = this.expire(combat, () => true, playerId);
        return [...expired.ops, this.replaceCombat(null), this.appendChat({ kind: 'combat_event', ...this.entryBase(playerId), event: 'ended', round: combat.round })];
      }
      case 'damage.apply':
        this.requireGm(role);
        return this.applyProposal(playerId, intent.data.proposalId, intent.data.amount);
      case 'damage.dismiss':
        this.requireGm(role);
        this.proposal(intent.data.proposalId);
        return [{ op: 'remove', path: toPointer('proposals', intent.data.proposalId) }];
      case 'hp.change':
        return this.changeHp(playerId, role, intent.data);
      case 'condition.add':
      case 'condition.remove':
      case 'exhaustion.set':
        return this.changeConditions(playerId, role, intent);
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
    // PV próprios só para tokens que não são personagem: os informados, ou a média do monstro.
    const hpMax = data.characterId !== undefined ? undefined : (data.hpMax ?? (data.monsterId !== undefined ? this.deps.monsterHpMax(data.monsterId) : undefined));
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
      hp: hpMax !== undefined ? { max: hpMax, damage: 0, temp: 0 } : null,
      conditions: NO_CONDITIONS,
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
    const character: SessionCharacter = { id: this.deps.newId(), ownerId, name: data.name, baseScores: null, rolledScores: null, steps: [], inventory: EMPTY_INVENTORY, hp: { damage: 0, temp: 0 }, adjustments: [], conditions: NO_CONDITIONS, deathSaves: NO_DEATH_SAVES, concentration: null };
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

  /** Ajuste do mestre: os efeitos já vêm validados pelo catálogo (schema do motor). */
  private addAdjustment(playerId: string, role: Role, data: IntentData<'adjustment.add'>): PatchOp[] {
    const character = this.ownCharacter(playerId, role, data.characterId);
    if (character.adjustments.length >= MAX_ADJUSTMENTS) throw violation(`No máximo ${MAX_ADJUSTMENTS} ajustes por personagem`);
    const adjustment = { id: this.deps.newId(), name: data.name, effects: data.effects };
    return [{ op: 'add', path: toPointer('characters', character.id, 'adjustments', '-'), value: adjustment }];
  }

  /**
   * Dano, cura e PV temporários (regras no motor, `applyHitPointChange`). O
   * mestre muda qualquer um; o jogador, o próprio personagem e os próprios
   * tokens. Cair a 0 PV, morte e Salvaguardas contra a Morte são da Fase 5.
   */
  private changeHp(playerId: string, role: Role, data: IntentData<'hp.change'>): PatchOp[] {
    const { change } = data;
    if ('characterId' in data.target) {
      if (change.kind === 'max') throw violation('Os PV máximos de um personagem vêm da ficha');
      const character = this.ownCharacter(playerId, role, data.target.characterId);
      const sheet = this.deps.characterSheet(character);
      if (!sheet) throw violation('O personagem ainda não tem ficha (defina os atributos)');
      return this.changeCharacterHp(playerId, character, sheet, { kind: change.kind, amount: change.amount }).ops;
    }
    const token = this.token(data.target.tokenId);
    if (role !== 'gm' && !token.ownerIds.includes(playerId)) throw notAllowed('Você não controla este token');
    const path = toPointer('tokens', token.id, 'hp');
    if (change.kind === 'max') {
      if (change.amount < 1) throw violation('PV máximos precisam ser pelo menos 1');
      const state = clampHitPoints(change.amount, token.hp ?? { damage: 0, temp: 0 });
      return [{ op: 'replace', path, value: { max: change.amount, ...state } }];
    }
    if (token.hp === null) throw violation(token.characterId ? 'Mude os PV no personagem' : 'Este token não tem PV (defina os PV máximos)');
    const result = applyHitPointChange(token.hp.max, token.hp, { kind: change.kind, amount: change.amount });
    return [{ op: 'replace', path, value: { max: token.hp.max, ...result.state } }];
  }

  // --- Condições (Fase 5, PR 2) ---------------------------------------------

  /**
   * Onde ficam as condições do alvo: no personagem (também quando o alvo é o
   * token dele) ou no próprio token. Quem pode: o mestre, o dono do personagem
   * e os donos do token, como nos PV.
   */
  private conditionHolder(
    playerId: string,
    role: Role,
    target: IntentData<'condition.add'>['target'],
  ): { path: string; state: ConditionState; name: string; immune: ReadonlySet<string>; logTarget: { characterId: string } | { tokenId: string } } {
    let character: SessionCharacter | undefined;
    if ('characterId' in target) {
      character = this.ownCharacter(playerId, role, target.characterId);
    } else {
      const token = this.token(target.tokenId);
      if (token.characterId !== null) {
        const linked = this.current.characters[token.characterId];
        if (!linked) throw violation('Personagem do token não encontrado');
        if (role !== 'gm' && !this.controls(playerId, token)) throw notAllowed('Você não controla este token');
        character = linked;
      } else {
        if (role !== 'gm' && !token.ownerIds.includes(playerId)) throw notAllowed('Você não controla este token');
        const creature = token.monsterId !== null ? this.deps.creature(token.monsterId) : undefined;
        const defenses = creature ? conditionDefenses(this.conditionsOf(token).conditions, creatureDefenses(creature).defenses) : undefined;
        // Do bloco, e as que vêm das condições (Petrificado é imune a Envenenado).
        const immune = new Set<string>(defenses ? defenses.conditionImmunities.map((c) => c.condition) : this.conditionsOf(token).conditions.has('petrified') ? ['poisoned'] : []);
        return { path: toPointer('tokens', token.id, 'conditions'), state: token.conditions, name: token.name, immune, logTarget: { tokenId: token.id } };
      }
    }
    const sheet = this.deps.characterSheet(character);
    const immune = new Set<string>(sheet ? sheet.defenses.conditionImmunities.map((c) => c.condition) : []);
    return { path: toPointer('characters', character.id, 'conditions'), state: character.conditions, name: character.name, immune, logTarget: { characterId: character.id } };
  }

  private changeConditions(playerId: string, role: Role, intent: Extract<Intent, { kind: 'condition.add' | 'condition.remove' | 'exhaustion.set' }>): PatchOp[] {
    const holder = this.conditionHolder(playerId, role, intent.data.target);
    const notes: string[] = [];
    /** Imune: o jogador é recusado; o mestre aplica mesmo assim (override), e o log registra. */
    const checkImmunity = (condition: TableCondition | 'exhaustion'): void => {
      if (!holder.immune.has(condition)) return;
      const message = `${holder.name} é imune a ${CONDITION_NAME[condition]}`;
      if (role !== 'gm') throw violation(message);
      notes.push(`${message} (aplicada pelo mestre)`);
    };
    let state: ConditionState;
    let change: Extract<ChatEntry, { kind: 'condition_changed' }>['change'];
    if (intent.kind === 'exhaustion.set') {
      const { level } = intent.data;
      if (level === holder.state.exhaustion) throw violation(`${holder.name} já está com Exaustão ${level}`);
      if (level > holder.state.exhaustion) checkImmunity('exhaustion');
      if (level >= MAX_EXHAUSTION_LEVEL) notes.push(`Exaustão ${MAX_EXHAUSTION_LEVEL}: ${holder.name} morre (SRD)`);
      state = { ...holder.state, exhaustion: level };
      change = { kind: 'exhaustion', from: holder.state.exhaustion, to: level };
    } else {
      const { condition } = intent.data;
      const has = holder.state.active.some((c) => c.condition === condition);
      if (intent.kind === 'condition.add') {
        if (has) throw violation(`${holder.name} já está ${CONDITION_NAME[condition]}`);
        checkImmunity(condition);
        const until = intent.data.until ? this.untilNextTurn(intent.data.until.at, intent.data.until.tokenId) : undefined;
        state = { ...holder.state, active: [...holder.state.active, { condition, ...(until ? { until } : {}) }] };
        change = { kind: 'added', condition };
      } else {
        if (!has) throw violation(`${holder.name} não está ${CONDITION_NAME[condition]}`);
        state = { ...holder.state, active: holder.state.active.filter((c) => c.condition !== condition) };
        change = { kind: 'removed', condition };
      }
    }
    const ops: PatchOp[] = [
      { op: 'replace', path: holder.path, value: state },
      this.appendChat({ kind: 'condition_changed', ...this.entryBase(playerId), target: holder.logTarget, targetName: holder.name, change, notes }),
    ];
    // Exaustão 6 mata: no personagem, o estado das Salvaguardas contra a Morte registra a morte.
    const character = 'characterId' in holder.logTarget ? this.current.characters[holder.logTarget.characterId] : undefined;
    let deathSaves = character?.deathSaves;
    if (character && change.kind === 'exhaustion' && change.to >= MAX_EXHAUSTION_LEVEL && !character.deathSaves.dead) {
      deathSaves = { ...character.deathSaves, dead: true };
      ops.push({ op: 'replace', path: toPointer('characters', character.id, 'deathSaves'), value: deathSaves });
      ops.push(this.deathStateEntry(playerId, character, 'exhaustion', deathSaves, [`Exaustão ${MAX_EXHAUSTION_LEVEL}: morto`]));
    }
    // Incapacitado (ou o que o inclui) ou morto: a Concentração termina.
    if (character && deathSaves) ops.push(...this.concentrationBreaks(playerId, character, state, deathSaves));
    return ops;
  }

  /** Duração até o início ou o fim do próximo turno do combatente (precisa de combate com ele). */
  private untilNextTurn(at: TurnExpiry['at'], tokenId: string): TurnExpiry {
    const combat = this.current.combat;
    if (!combat) throw violation('Duração por turno só com combate em andamento');
    const index = combat.combatants.findIndex((c) => c.tokenId === tokenId);
    if (index < 0) throw violation('A duração precisa de um combatente do combate');
    return { at, tokenId, round: nextTurnRound(combat, index) };
  }

  /** A ficha do personagem, se quem pede pode rolar por ele (dono ou mestre). */
  private sheetOf(playerId: string, role: Role, characterId: string): { character: SessionCharacter; sheet: DerivedSheet } {
    const character = this.ownCharacter(playerId, role, characterId);
    const sheet = this.deps.characterSheet(character);
    if (!sheet) throw violation('O personagem ainda não tem ficha (defina os atributos)');
    return { character, sheet };
  }

  /** Teste d20 a partir da ficha: modificador, Vantagem/Desvantagem e regras do d20 vêm do motor; o dado, do RNG do Host. */
  private rollFromSheet(playerId: string, role: Role, data: IntentData<'roll.d20'>): ChatEntry {
    const { character, sheet } = this.sheetOf(playerId, role, data.characterId);
    const roll = sheetD20(sheet, data.target, { advantage: data.advantage, disadvantage: data.disadvantage });
    if (!roll) throw violation('Este ataque não está na ficha (a arma precisa estar equipada)');
    const result = rollD20(roll.input, this.deps.rng);
    const { target } = data;
    const attack = target.kind === 'attack' ? sheet.attacks.find((a) => a.instanceId === target.instanceId) : undefined;
    return {
      kind: 'd20_roll',
      ...this.entryBase(playerId),
      characterId: character.id,
      characterName: character.name,
      target: data.target,
      ...(attack ? { label: attack.name.slice(0, 100) } : {}),
      visibility: data.visibility,
      mode: roll.input.mode,
      dice: result.dice,
      natural: result.natural,
      modifier: roll.input.modifier,
      total: result.total,
      // Crítico e falha crítica só existem na jogada de ataque (o 20 e o 1 da Salvaguarda contra a Morte valem no `death_save`, nota 0044).
      critical: target.kind === 'attack' && result.critical,
      fumble: target.kind === 'attack' && result.fumble,
      parts: roll.parts.map((p) => ({ label: p.label.slice(0, 200), value: p.value })),
      advantage: roll.advantage,
      disadvantage: roll.disadvantage,
      notes: d20StepNotes(result.steps),
      reminders: roll.reminders,
    };
  }

  /** Dano de uma arma equipada (crítico dobra os dados, Versatile com as duas mãos). */
  private rollDamage(playerId: string, role: Role, data: IntentData<'roll.damage'>): ChatEntry {
    const { character, sheet } = this.sheetOf(playerId, role, data.characterId);
    const attack = sheet.attacks.find((a) => a.instanceId === data.instanceId);
    if (!attack) throw violation('Este ataque não está na ficha (a arma precisa estar equipada)');
    const result = rollWeaponDamage(attack, { critical: data.critical, versatile: data.versatile }, this.deps.rng);
    return {
      kind: 'damage_roll',
      ...this.entryBase(playerId),
      characterId: character.id,
      characterName: character.name,
      label: attack.name.slice(0, 100),
      visibility: data.visibility,
      critical: data.critical === true,
      groups: result.groups.map((g) => ({ dice: g.dice, type: g.type, ...(g.source ? { source: g.source } : {}), rolls: g.rolls, total: g.total })),
      bonus: result.bonus,
      total: result.total,
      ...(result.dieMinimum ? { dieMinimum: result.dieMinimum } : {}),
    };
  }

  // --- Ataques contra um alvo (Fase 4, PR 3) --------------------------------

  private proposal(proposalId: string): SessionState['proposals'][string] {
    const proposal = this.current.proposals[proposalId];
    if (!proposal) throw violation('Proposta de dano não encontrada (já aplicada ou descartada)');
    return proposal;
  }

  /** Condições que valem para o token (as do personagem, num token de personagem), com as implícitas. */
  private conditionsOf(token: Token): { conditions: Set<Condition>; exhaustion: number } {
    const state = token.characterId !== null ? (this.current.characters[token.characterId]?.conditions ?? NO_CONDITIONS) : token.conditions;
    return { conditions: effectiveConditions(state.active.map((c) => c.condition)), exhaustion: state.exhaustion };
  }

  /** Distância em pés entre dois tokens do mesmo mapa (motor); `undefined` sem o atacante no mapa do alvo. */
  private distanceBetween(a: Token | undefined, b: Token): number | undefined {
    if (!a || a.mapId !== b.mapId) return undefined;
    const footprint = (t: Token) => ({ x: t.position.x / WORLD_UNITS_PER_CELL, y: t.position.y / WORLD_UNITS_PER_CELL, size: t.size });
    return distanceFeet(footprint(a), footprint(b));
  }

  /** CA e defesas de um token alvo: as da ficha do personagem ligado, ou as do bloco do monstro. */
  private targetOf(token: Token): { ac: number; defenses: Defenses; reminders: string[] } {
    if (token.characterId !== null) {
      const character = this.current.characters[token.characterId];
      const sheet = character ? this.deps.characterSheet(character) : undefined;
      if (!sheet) throw violation('O personagem do alvo ainda não tem ficha');
      return { ac: sheet.ac.total, defenses: sheet.defenses, reminders: [] };
    }
    const creature = token.monsterId !== null ? this.deps.creature(token.monsterId) : undefined;
    if (!creature) throw violation('O alvo não tem CA conhecida (não é personagem nem monstro do compêndio)');
    const { defenses, reminders } = creatureDefenses(creature);
    return { ac: creature.ac, defenses: conditionDefenses(this.conditionsOf(token).conditions, defenses), reminders };
  }

  /**
   * Ataque contra um token: o Host rola contra a CA do alvo e, no acerto,
   * rola o dano e aplica as defesas do alvo com o motor. O dano vira uma
   * proposta: só muda os PV quando o mestre aplica (override manual).
   */
  private makeAttack(playerId: string, role: Role, data: IntentData<'attack.make'>, cleaveOf?: string): PatchOp[] {
    const target = this.token(data.targetTokenId);
    const declared = { advantage: data.advantage, disadvantage: data.disadvantage };
    let attackerName: string;
    let label: string;
    let d20: SheetD20;
    let rollDamage: (critical: boolean) => { groups: ReturnType<typeof rollActionDamage>; bonus: number };
    /** Token do atacante (para a distância até o alvo), se estiver no mapa. */
    let attackerToken: Token | undefined;
    /** Arma da ficha: o que a maestria dela permite depois do resultado. */
    let weapon: { ref: { characterId: string; instanceId: string }; mastery: (hit: boolean, damaged: boolean) => ReturnType<typeof masteryOutcome> | undefined } | undefined;

    if ('characterId' in data.attacker) {
      const { character, sheet } = this.sheetOf(playerId, role, data.attacker.characterId);
      const instanceId = data.attacker.instanceId;
      const attack = sheet.attacks.find((a) => a.instanceId === instanceId);
      const roll = sheetD20(sheet, { kind: 'attack', instanceId }, declared);
      if (!attack || !roll) throw violation('Este ataque não está na ficha (a arma precisa estar equipada)');
      d20 = roll;
      attackerToken = Object.values(this.current.tokens).find((t) => t.characterId === character.id && t.mapId === target.mapId);
      attackerName = character.name;
      label = attack.name;
      const abilityModifier = sheet.abilities[attack.ability].modifier;
      rollDamage = (critical) => {
        const rolled = rollWeaponDamage(attack, { critical }, this.deps.rng);
        // Cleave: o dano do segundo ataque fica sem o modificador de atributo, a menos que seja negativo.
        return { groups: rolled.groups, bonus: cleaveOf !== undefined ? cleaveDamageBonus(rolled.bonus, abilityModifier) : rolled.bonus };
      };
      weapon = {
        ref: { characterId: character.id, instanceId },
        mastery: (hit, damaged) =>
          attack.mastery.available
            ? masteryOutcome({
                property: attack.mastery.property,
                hit,
                damaged,
                abilityModifier,
                proficiencyBonus: sheet.proficiencyBonus,
                damageType: attack.damage.type,
                targetSize: target.size,
                fromCleave: cleaveOf !== undefined,
              })
            : undefined,
      };
    } else {
      const token = this.token(data.attacker.tokenId);
      if (role !== 'gm' && !token.ownerIds.includes(playerId)) throw notAllowed('Você não controla este token');
      const creature = token.monsterId !== null ? this.deps.creature(token.monsterId) : undefined;
      const actionId = data.attacker.actionId;
      const action = creature?.actions.find((a) => a.id === actionId);
      if (!creature || action?.kind !== 'attack') throw violation('Ação de ataque não encontrada no bloco do monstro');
      // Bônus do bloco, com a Exaustão e as condições do monstro (Envenenado, Caído…).
      d20 = creatureD20({ label: 'Bônus de ataque', modifier: action.toHit }, this.conditionsOf(token), { kind: 'attack' }, declared);
      attackerToken = token;
      attackerName = token.name;
      label = action.name;
      rollDamage = (critical) => ({ groups: rollActionDamage(action.damage, critical, this.deps.rng), bonus: 0 });
    }
    const defender = this.targetOf(target);
    // Condições do alvo: Vantagem contra Impedido, Caído pela distância, crítico automático contra Paralisado a até 5 ft.
    const against = attackedConditions(this.conditionsOf(target).conditions, this.distanceBetween(attackerToken, target));
    // Efeitos temporários das maestrias: Sap pesa no próximo ataque do alvo; Vex ajuda o próximo do atacante contra ele. Gastam-se aqui.
    const combat = this.current.combat;
    const used = new Set<string>();
    const fromEffects = { advantage: [] as string[], disadvantage: [] as string[] };
    if (combat && attackerToken) {
      for (const effect of combat.effects) {
        const source = this.current.tokens[effect.sourceTokenId]?.name ?? 'Token removido';
        if (effect.kind === 'sap' && effect.targetTokenId === attackerToken.id) {
          fromEffects.disadvantage.push(`Sap (${source})`);
          used.add(effect.id);
        } else if (effect.kind === 'vex' && effect.sourceTokenId === attackerToken.id && effect.targetTokenId === target.id) {
          fromEffects.advantage.push('Vex');
          used.add(effect.id);
        }
      }
    }
    const advantage = [...d20.advantage, ...against.advantage.map((s) => s.name), ...fromEffects.advantage];
    const disadvantage = [...d20.disadvantage, ...against.disadvantage.map((s) => s.name), ...fromEffects.disadvantage];
    d20 = { ...d20, input: { ...d20.input, mode: d20Mode(advantage.length > 0, disadvantage.length > 0) }, advantage, disadvantage, reminders: [...d20.reminders, ...against.reminders] };
    const result = resolveAttack(
      { d20: d20.input, targetAc: defender.ac, rollDamage, defenses: defender.defenses, autoCritical: against.autoCritical.length > 0 },
      this.deps.rng,
    );
    const autoCriticalNote =
      result.critical && !result.roll.critical ? [`Acerto Crítico: alvo ${against.autoCritical.map((s) => s.name).join(', ')} a até 5 ft`] : [];
    const damaged = (result.damage?.applied.total ?? 0) > 0;
    let mastery = weapon?.mastery(result.hit, damaged);
    // Com combate e o atacante nele, Sap, Vex e Slow viram efeitos temporários de verdade (até o próximo turno do atacante).
    const attackerId = attackerToken?.id;
    const attackerIndex = combat && attackerId !== undefined ? combat.combatants.findIndex((c) => c.tokenId === attackerId) : -1;
    const timed = mastery && combat && attackerToken && attackerIndex >= 0 ? timedMastery(mastery.property, result.hit, damaged) : undefined;
    let effects = combat ? combat.effects.filter((e) => !used.has(e.id)) : [];
    const started: TimedEffect[] = [];
    if (timed && combat && attackerToken && mastery) {
      const effect: TimedEffect = {
        id: this.deps.newId(),
        kind: timed,
        sourceTokenId: attackerToken.id,
        targetTokenId: target.id,
        until: { at: TIMED_MASTERY_UNTIL[timed], tokenId: attackerToken.id, round: nextTurnRound(combat, attackerIndex) },
      };
      // Slow não acumula: o novo substitui o anterior no mesmo alvo.
      if (timed === 'slow') effects = effects.filter((e) => !(e.kind === 'slow' && e.targetTokenId === target.id));
      effects = [...effects, effect];
      started.push(effect);
      mastery = { ...mastery, notes: [timedMasteryNote(timed, attackerName, target.name)] };
    }
    const entryId = this.deps.newId();
    const ops: PatchOp[] = [];
    let damage: Extract<ChatEntry, { kind: 'attack_roll' }>['damage'];
    if (result.damage && result.damage.groups.length > 0) {
      const proposalId = this.deps.newId();
      damage = {
        groups: result.damage.groups,
        bonus: result.damage.bonus,
        total: result.damage.applied.total,
        defenses: damageNotes(result.damage.applied),
        proposalId,
      };
      ops.push({
        op: 'add',
        path: toPointer('proposals', proposalId),
        value: { id: proposalId, entryId, targetTokenId: target.id, targetName: target.name, amount: result.damage.applied.total },
      });
    }
    const entry: ChatEntry = {
      kind: 'attack_roll',
      id: entryId,
      at: this.deps.now(),
      authorId: playerId,
      attackerName,
      label: label.slice(0, 100),
      targetTokenId: target.id,
      targetName: target.name,
      visibility: data.visibility,
      mode: d20.input.mode,
      dice: result.roll.dice,
      natural: result.roll.natural,
      modifier: d20.input.modifier,
      total: result.roll.total,
      critical: result.critical,
      fumble: result.roll.fumble,
      advantage: d20.advantage,
      disadvantage: d20.disadvantage,
      notes: [...d20StepNotes(result.roll.steps), ...autoCriticalNote].slice(0, 50),
      reminders: [...d20.reminders, ...defender.reminders].slice(0, 50),
      hit: result.hit,
      ...(damage ? { damage } : {}),
      ...(weapon ? { weapon: weapon.ref } : {}),
      ...(mastery && (mastery.action || mastery.notes.length > 0)
        ? { mastery: { property: mastery.property, ...(mastery.action ? { action: mastery.action } : {}), notes: mastery.notes } }
        : {}),
      ...(cleaveOf !== undefined ? { masteryOf: cleaveOf } : {}),
    };
    const combatOps: PatchOp[] =
      combat && (used.size > 0 || started.length > 0)
        ? [...started.map((e) => this.appendChat(this.timedEffectEntry(playerId, 'started', e))), this.replaceCombat({ ...combat, effects })]
        : [];
    return [this.appendChat(entry), ...ops, ...combatOps];
  }

  // --- Combate e iniciativa (Fase 5, PR 1) ---------------------------------

  private combat(): Combat {
    if (!this.current.combat) throw violation('Não há combate em andamento');
    return this.current.combat;
  }

  private combatant(tokenId: string): number {
    const index = this.combat().combatants.findIndex((c) => c.tokenId === tokenId);
    if (index < 0) throw violation('Este token não está no combate');
    return index;
  }

  /** O combate inteiro vai num `replace` (é pequeno, e a visibilidade filtra o valor todo, seção 2.12). */
  private replaceCombat(combat: Combat | null): PatchOp {
    return { op: 'replace', path: '/combat', value: combat };
  }

  /**
   * O Host rola a iniciativa de cada token: a da ficha do personagem ligado,
   * o bônus publicado do monstro, ou +0. Surpresa dá Desvantagem.
   */
  private rollInitiatives(data: IntentData<'combat.start'>): { combatants: Combat['combatants']; entry: Extract<ChatEntry, { kind: 'initiative_roll' }>['results'] } {
    const surprised = new Set(data.surprisedTokenIds ?? []);
    const rolled = data.tokenIds.map((tokenId) => {
      const token = this.token(tokenId);
      const notes: string[] = [];
      let modifier: number;
      let advantage: string[];
      let disadvantage: string[];
      let rules: D20RollInput['rules'];
      const character = token.characterId !== null ? this.current.characters[token.characterId] : undefined;
      const sheet = character ? this.deps.characterSheet(character) : undefined;
      const roll = sheet ? sheetD20(sheet, { kind: 'initiative' }) : undefined;
      const creature = token.monsterId !== null ? this.deps.creature(token.monsterId) : undefined;
      if (roll) {
        modifier = roll.input.modifier;
        advantage = roll.advantage;
        disadvantage = roll.disadvantage;
        rules = roll.input.rules;
      } else {
        if (!creature) notes.push(token.characterId !== null ? 'Personagem sem ficha: iniciativa +0' : 'Sem ficha nem bloco de monstro: iniciativa +0');
        // Bônus do bloco (ou +0), com a Exaustão e as condições (Incapacitado, Invisível).
        const own = creatureD20({ label: 'Iniciativa', modifier: creature?.initiative ?? 0 }, this.conditionsOf(token), { kind: 'initiative' });
        modifier = own.input.modifier;
        advantage = own.advantage;
        disadvantage = own.disadvantage;
      }
      if (surprised.has(tokenId)) disadvantage = [...disadvantage, 'Surpresa'];
      const input: D20RollInput = { modifier, mode: d20Mode(advantage.length > 0, disadvantage.length > 0), ...(rules ? { rules } : {}) };
      const result = rollD20(input, this.deps.rng);
      const total = Math.max(MIN_INITIATIVE, Math.min(MAX_INITIATIVE, result.total));
      return {
        combatant: { tokenId, initiative: total, modifier },
        result: {
          tokenId,
          name: token.name,
          mode: input.mode,
          dice: result.dice,
          natural: result.natural,
          modifier,
          total,
          notes: [
            ...(advantage.length > 0 ? [`Vantagem: ${advantage.join(', ')}`] : []),
            ...(disadvantage.length > 0 ? [`Desvantagem: ${disadvantage.join(', ')}`] : []),
            ...d20StepNotes(result.steps),
            ...notes,
          ].slice(0, 50),
        },
      };
    });
    return { combatants: rolled.map((r) => r.combatant), entry: rolled.map((r) => r.result) };
  }

  /** Ordem de turnos pelo motor; quem estava na vez continua na vez. */
  private ordered(combatants: Combat['combatants'], current: string | undefined): { combatants: Combat['combatants']; turn: number } {
    const sorted = sortByInitiative(combatants.map((c) => ({ ...c, initiative: c.initiative ?? 0, modifier: c.modifier ?? 0 })));
    const turn = current === undefined ? 0 : Math.max(0, sorted.findIndex((c) => c.tokenId === current));
    return { combatants: sorted, turn };
  }

  private startCombat(playerId: string, data: IntentData<'combat.start'>): PatchOp[] {
    if (this.current.combat) throw violation('Já há um combate em andamento');
    const { combatants, entry } = this.rollInitiatives(data);
    const order = this.ordered(combatants, undefined);
    const first = order.combatants[order.turn]?.tokenId;
    return [
      this.replaceCombat({ round: 1, turn: order.turn, combatants: order.combatants, effects: [] }),
      this.appendChat({ kind: 'combat_event', ...this.entryBase(playerId), event: 'started', round: 1 }),
      this.appendChat({ kind: 'initiative_roll', ...this.entryBase(playerId), results: entry }),
      ...data.tokenIds.flatMap((tokenId) => this.triggers(playerId, this.current, 'initiative', tokenId)),
      ...(first !== undefined ? this.turnStart(playerId, this.current, first) : []),
    ];
  }

  private joinCombat(playerId: string, data: IntentData<'combat.add'>): PatchOp[] {
    const combat = this.combat();
    if (data.tokenIds.some((id) => combat.combatants.some((c) => c.tokenId === id))) throw violation('Token já está no combate');
    if (combat.combatants.length + data.tokenIds.length > MAX_COMBATANTS) throw violation(`No máximo ${MAX_COMBATANTS} combatentes`);
    const { combatants, entry } = this.rollInitiatives(data);
    const order = this.ordered([...combat.combatants, ...combatants], combat.combatants[combat.turn]?.tokenId);
    return [
      this.replaceCombat({ ...combat, turn: order.turn, combatants: order.combatants }),
      this.appendChat({ kind: 'initiative_roll', ...this.entryBase(playerId), results: entry }),
      ...data.tokenIds.flatMap((tokenId) => this.triggers(playerId, this.current, 'initiative', tokenId)),
    ];
  }

  /** Tira o token do combate (se estiver nele); o último a sair encerra o combate. */
  private leaveCombat(playerId: string, tokenId: string): PatchOp[] {
    const combat = this.current.combat;
    const index = combat ? combat.combatants.findIndex((c) => c.tokenId === tokenId) : -1;
    if (!combat || index < 0) return [];
    const position = turnAfterRemoval(combat, index, combat.combatants.length);
    if (!position) {
      const all = this.expire(combat, () => true, playerId);
      return [...all.ops, this.replaceCombat(null), this.appendChat({ kind: 'combat_event', ...this.entryBase(playerId), event: 'ended', round: combat.round })];
    }
    // Durações presas aos turnos de quem saiu não teriam fim: terminam agora, como os efeitos que ele causou ou sofria.
    const expired = this.expire(combat, (until) => until.tokenId === tokenId, playerId, (e) => e.sourceTokenId === tokenId || e.targetTokenId === tokenId);
    const combatants = combat.combatants.filter((_, i) => i !== index);
    return [
      ...expired.ops,
      this.replaceCombat({ round: position.round, turn: position.turn, combatants, effects: expired.effects }),
      ...(position.newRound ? [this.appendChat({ kind: 'combat_event', ...this.entryBase(playerId), event: 'round', round: position.round })] : []),
    ];
  }

  private setInitiative(tokenId: string, initiative: number): PatchOp[] {
    const combat = this.combat();
    const index = this.combatant(tokenId);
    const combatants = combat.combatants.map((c, i) => (i === index ? { ...c, initiative } : c));
    const order = this.ordered(combatants, combat.combatants[combat.turn]?.tokenId);
    return [this.replaceCombat({ ...combat, turn: order.turn, combatants: order.combatants })];
  }

  /** O jogador controla o token: dono do token ou do personagem que ele representa. */
  private controls(playerId: string, token: Token): boolean {
    if (token.ownerIds.includes(playerId)) return true;
    return token.characterId !== null && this.current.characters[token.characterId]?.ownerId === playerId;
  }

  private nextTurn(playerId: string, role: Role): PatchOp[] {
    const combat = this.combat();
    if (role !== 'gm') {
      const current = combat.combatants[combat.turn];
      const token = current ? this.current.tokens[current.tokenId] : undefined;
      if (!token || !this.controls(playerId, token)) throw notAllowed('Só o mestre ou quem controla o combatente da vez passa o turno');
    }
    const position = nextTurn(combat, combat.combatants.length);
    // Termina o que vai até o fim do turno que acabou e até o início do turno que começa.
    const ended = combat.combatants[combat.turn]?.tokenId;
    const started = combat.combatants[position.turn]?.tokenId;
    const events: TurnExpiry[] = [
      ...(ended !== undefined ? [{ at: 'turn_end' as const, tokenId: ended, round: combat.round }] : []),
      ...(started !== undefined ? [{ at: 'turn_start' as const, tokenId: started, round: position.round }] : []),
    ];
    const expired = this.expire(combat, (until) => events.some((e) => expiresAt(until, e)), playerId);
    // Lembretes e cura com o estado depois das durações encerradas (nota 0043).
    const after = expired.ops.length > 0 ? applyPatch(this.current, expired.ops) : this.current;
    const endOps = ended !== undefined ? this.triggers(playerId, after, 'turn_end', ended) : [];
    return [
      ...(position.newRound ? [this.appendChat({ kind: 'combat_event', ...this.entryBase(playerId), event: 'round', round: position.round })] : []),
      ...expired.ops,
      ...endOps,
      ...(started !== undefined ? this.turnStart(playerId, endOps.length > 0 ? applyPatch(after, endOps) : after, started) : []),
      this.replaceCombat({ ...combat, round: position.round, turn: position.turn, effects: expired.effects }),
    ];
  }

  /**
   * Lembretes (`reminder`) e cura do início do turno (`turn_start_heal`) da
   * ficha do personagem ligado ao token, no momento `on`, avaliados em `state`
   * (nota 0043). A cura entra nos PV do personagem; tudo vai numa entrada
   * `turn_trigger`, só se houver algo a dizer. Tokens sem personagem ou sem
   * ficha não têm lembretes.
   */
  private triggers(playerId: string, state: SessionState, on: TriggerMoment, tokenId: string): PatchOp[] {
    const token = state.tokens[tokenId];
    const character = token && token.characterId !== null ? state.characters[token.characterId] : undefined;
    if (!token || !character) return [];
    const sheet = this.deps.characterSheet(character);
    if (!sheet) return [];
    const max = sheet.hpMax.total;
    let current = character;
    const healOps: PatchOp[] = [];
    const items: Extract<ChatEntry, { kind: 'turn_trigger' }>['items'] = [];
    for (const trigger of sheet.triggers) {
      if (trigger.on !== on) continue;
      if (trigger.kind === 'reminder') {
        items.push({ source: trigger.source.name.slice(0, 100), text: trigger.text.slice(0, 500) });
        continue;
      }
      // Heroic Rally: Sangrando e com pelo menos 1 PV (com 0 PV, a criatura está morrendo).
      if (current.deathSaves.dead) continue;
      if (trigger.bloodiedOnly && (currentHitPoints(max, current.hp) < 1 || !isBloodied(max, current.hp))) continue;
      const healed = this.changeCharacterHp(playerId, current, sheet, { kind: 'healing', amount: trigger.amount });
      if (healed.result.hpChange <= 0) continue;
      current = healed.after;
      healOps.push(...healed.ops);
      items.push({ source: trigger.source.name.slice(0, 100), healed: healed.result.hpChange });
    }
    if (items.length === 0) return [];
    return [
      this.appendChat({ kind: 'turn_trigger', ...this.entryBase(playerId), on, tokenId, name: token.name, items: items.slice(0, MAX_TURN_TRIGGER_ITEMS) }),
      ...healOps,
    ];
  }

  // --- Salvaguardas contra a Morte (Fase 5, PR 5a; nota 0044) ---------------

  /** Algum token do personagem está no combate. */
  private inCombat(characterId: string): boolean {
    const combat = this.current.combat;
    return combat !== null && combat.combatants.some((c) => this.current.tokens[c.tokenId]?.characterId === characterId);
  }

  /**
   * Início do turno do token: primeiro a Salvaguarda contra a Morte (se o
   * personagem ligado está morrendo), depois os lembretes e a cura do turno,
   * com o estado depois da rolagem.
   */
  private turnStart(playerId: string, state: SessionState, tokenId: string): PatchOp[] {
    const token = state.tokens[tokenId];
    const character = token && token.characterId !== null ? state.characters[token.characterId] : undefined;
    const sheet = character ? this.deps.characterSheet(character) : undefined;
    const dying = character !== undefined && sheet !== undefined && isDying(currentHitPoints(sheet.hpMax.total, character.hp), character.deathSaves);
    const save = dying ? this.rollDeathSave(playerId, state, character.id) : [];
    return [...save, ...this.triggers(playerId, save.length > 0 ? applyPatch(state, save) : state, 'turn_start', tokenId)];
  }

  /**
   * O Host rola a Salvaguarda contra a Morte com a ficha (Vantagens, regras do
   * d20, bônus de `save.all`) e aplica o resultado pelo motor: 20 recupera 1
   * PV, 1 conta duas falhas, três sucessos estabilizam, três falhas matam.
   */
  private rollDeathSave(playerId: string, state: SessionState, characterId: string): PatchOp[] {
    const character = state.characters[characterId];
    const sheet = character ? this.deps.characterSheet(character) : undefined;
    if (!character || !sheet) return [];
    const roll = sheetD20(sheet, { kind: 'death_save' });
    if (!roll) return [];
    const result = rollD20(roll.input, this.deps.rng);
    const resolved = resolveDeathSave(character.deathSaves, { total: result.total, natural1: result.fumble, natural20: result.critical });
    const notes = [
      ...(roll.advantage.length > 0 ? [`Vantagem: ${roll.advantage.join(', ')}`] : []),
      ...(roll.disadvantage.length > 0 ? [`Desvantagem: ${roll.disadvantage.join(', ')}`] : []),
      ...d20StepNotes(result.steps),
    ];
    let ops: PatchOp[];
    let deathSaves = resolved.state;
    if (resolved.outcome === 'revived') {
      const healed = this.changeCharacterHp(playerId, character, sheet, { kind: 'healing', amount: 1 }, false, false);
      ops = healed.ops;
      deathSaves = healed.after.deathSaves;
      notes.push('20: recupera 1 PV');
    } else {
      ops = [{ op: 'replace', path: toPointer('characters', character.id, 'deathSaves'), value: deathSaves }];
      if (resolved.outcome === 'two_failures') notes.push('1: duas falhas');
      if (deathSaves.stable) notes.push('Três sucessos: Estável');
      if (deathSaves.dead) notes.push('Três falhas: morto');
    }
    return [
      this.appendChat({
        kind: 'death_save',
        ...this.entryBase(playerId),
        characterId: character.id,
        characterName: character.name,
        mode: roll.input.mode,
        dice: result.dice,
        natural: result.natural,
        modifier: roll.input.modifier,
        total: result.total,
        outcome: resolved.outcome,
        deathSaves,
        notes: notes.slice(0, 50),
      }),
      ...ops,
    ];
  }

  private deathStateEntry(playerId: string, character: SessionCharacter, cause: Extract<ChatEntry, { kind: 'death_state' }>['cause'], deathSaves: DeathSaveState, notes: string[]): PatchOp {
    return this.appendChat({ kind: 'death_state', ...this.entryBase(playerId), characterId: character.id, characterName: character.name, cause, deathSaves, notes });
  }

  /**
   * Mudança de PV de um personagem com as regras de 0 PV (motor,
   * `engine/death.ts`): cair a 0 deixa Inconsciente (dano massivo mata), dano
   * com 0 PV conta falhas, recuperar PV zera a contagem e tira o Inconsciente.
   * Um personagem morto não recupera PV. Devolve as operações (PV, condições,
   * Salvaguardas contra a Morte e os registros no chat) e o personagem depois.
   * `log: false` omite o `death_state` (quem chama já registra, como a rolagem).
   */
  private changeCharacterHp(
    playerId: string,
    character: SessionCharacter,
    sheet: DerivedSheet,
    change: HitPointChange,
    critical = false,
    log = true,
  ): { ops: PatchOp[]; result: HitPointResult; after: SessionCharacter } {
    if (change.kind === 'healing' && character.deathSaves.dead) throw violation(`${character.name} está morto: o mestre o revive antes de curar`);
    const max = sheet.hpMax.total;
    const result = applyHitPointChange(max, character.hp, change);
    let { conditions, deathSaves } = character;
    const notes: string[] = [];
    const hasUnconscious = conditions.active.some((c) => c.condition === 'unconscious');
    let condition: { kind: 'added' | 'removed'; note: string } | undefined;
    if (change.kind === 'damage') {
      const death = deathAfterDamage(deathSaves, result, critical);
      deathSaves = death.state;
      if (death.event === 'unconscious' && !hasUnconscious) {
        conditions = { ...conditions, active: [...conditions.active, { condition: 'unconscious' }] };
        condition = { kind: 'added', note: 'Caiu a 0 PV' };
      }
      if (death.event === 'dead') notes.push(result.massiveDamage ? 'Dano massivo: morte instantânea' : 'Três falhas: morto');
      if (death.event === 'failure') notes.push('Dano com 0 PV: uma falha');
      if (death.event === 'two_failures') notes.push('Acerto Crítico com 0 PV: duas falhas');
      if (character.deathSaves.stable && !deathSaves.stable) notes.push('Deixou de estar Estável');
    } else if (change.kind === 'healing' && result.hpChange > 0 && currentHitPoints(max, character.hp) === 0) {
      deathSaves = deathAfterHealing(deathSaves);
      if (hasUnconscious) {
        conditions = { ...conditions, active: conditions.active.filter((c) => c.condition !== 'unconscious') };
        condition = { kind: 'removed', note: 'Recuperou PV' };
      }
      notes.push('Recuperou PV: contagem zerada');
    }
    const deathChanged = JSON.stringify(deathSaves) !== JSON.stringify(character.deathSaves);
    const ops: PatchOp[] = [{ op: 'replace', path: toPointer('characters', character.id, 'hp'), value: result.state }];
    if (condition) {
      ops.push({ op: 'replace', path: toPointer('characters', character.id, 'conditions'), value: conditions });
      ops.push(
        this.appendChat({
          kind: 'condition_changed',
          ...this.entryBase(playerId),
          target: { characterId: character.id },
          targetName: character.name,
          change: { kind: condition.kind, condition: 'unconscious' },
          notes: [condition.note],
        }),
      );
    }
    if (deathChanged) {
      ops.push({ op: 'replace', path: toPointer('characters', character.id, 'deathSaves'), value: deathSaves });
      if (log && notes.length > 0) ops.push(this.deathStateEntry(playerId, character, change.kind === 'damage' ? 'damage' : 'healing', deathSaves, notes));
    }
    // Concentração: Inconsciente ou morto encerra; senão, dano pede a salvaguarda de Constituição.
    let concentration = character.concentration;
    const broken = this.concentrationBreaks(playerId, character, conditions, deathSaves);
    if (broken.length > 0) {
      ops.push(...broken);
      concentration = null;
    } else if (concentration && change.kind === 'damage' && Math.trunc(change.amount) > 0) {
      const kept = this.concentrationSave(playerId, character, sheet, concentration, Math.trunc(change.amount));
      ops.push(...kept.ops);
      if (!kept.kept) concentration = null;
    }
    return { ops, result, after: { ...character, hp: result.state, conditions, deathSaves, concentration } };
  }

  // --- Concentração (Fase 5, PR 5b; nota 0045) -------------------------------

  /** Passa a se concentrar numa magia da ficha que exige Concentração; a anterior termina. */
  private concentrate(playerId: string, role: Role, characterId: string, spellId: string): PatchOp[] {
    const { character, sheet } = this.sheetOf(playerId, role, characterId);
    if (character.deathSaves.dead) throw violation(`${character.name} está morto`);
    if (effectiveConditions(character.conditions.active.map((c) => c.condition)).has('incapacitated')) throw violation(`${character.name} está Incapacitado`);
    if (!sheet.spellcasting.concentration.includes(spellId)) throw violation('Esta magia não está na ficha ou não exige Concentração');
    if (character.concentration?.spellId === spellId) throw violation(`${character.name} já está concentrado nesta magia`);
    const name = (this.deps.spellName(spellId) ?? spellId).slice(0, 100);
    return [
      ...(character.concentration ? this.endConcentration(playerId, character, 'replaced') : []),
      { op: 'replace', path: toPointer('characters', character.id, 'concentration'), value: { spellId, name } },
      this.appendChat({ kind: 'concentration', ...this.entryBase(playerId), characterId: character.id, characterName: character.name, spellName: name, event: 'started', notes: [] }),
    ];
  }

  private endConcentration(
    playerId: string,
    character: SessionCharacter,
    reason: Exclude<Extract<ChatEntry, { kind: 'concentration' }>['reason'], undefined>,
    notes: string[] = [],
  ): PatchOp[] {
    if (!character.concentration) return [];
    return [
      { op: 'replace', path: toPointer('characters', character.id, 'concentration'), value: null },
      this.appendChat({
        kind: 'concentration',
        ...this.entryBase(playerId),
        characterId: character.id,
        characterName: character.name,
        spellName: character.concentration.name,
        event: 'ended',
        reason,
        notes,
      }),
    ];
  }

  /** A Concentração termina se o personagem morreu ou está Incapacitado (ou com o que o inclui). */
  private concentrationBreaks(playerId: string, character: SessionCharacter, conditions: ConditionState, deathSaves: DeathSaveState): PatchOp[] {
    if (!character.concentration) return [];
    if (deathSaves.dead) return this.endConcentration(playerId, character, 'dead');
    if (effectiveConditions(conditions.active.map((c) => c.condition)).has('incapacitated')) return this.endConcentration(playerId, character, 'incapacitated');
    return [];
  }

  /**
   * Dano num personagem concentrado: salvaguarda de Constituição pela ficha,
   * com o contexto de Concentração (Eldritch Mind), CD = o maior entre 10 e
   * metade do dano, até 30. `keep_concentration` (Relentless Hunter) dispensa.
   */
  private concentrationSave(
    playerId: string,
    character: SessionCharacter,
    sheet: DerivedSheet,
    concentration: NonNullable<SessionCharacter['concentration']>,
    damage: number,
  ): { ops: PatchOp[]; kept: boolean } {
    const base = { ...this.entryBase(playerId), characterId: character.id, characterName: character.name, spellName: concentration.name };
    if (sheet.spellcasting.keepConcentration.includes(concentration.spellId)) {
      return { ops: [this.appendChat({ kind: 'concentration', ...base, event: 'kept', notes: ['O dano não quebra a Concentração nesta magia'] })], kept: true };
    }
    const dc = concentrationDc(damage);
    const roll = sheetD20(sheet, { kind: 'save', ability: 'con' }, {}, { concentration: true });
    if (!roll) return { ops: [], kept: true };
    const result = rollD20({ ...roll.input, dc }, this.deps.rng);
    const success = result.success === true;
    const ops: PatchOp[] = [
      this.appendChat({
        kind: 'concentration_save',
        ...base,
        dc,
        mode: roll.input.mode,
        dice: result.dice,
        natural: result.natural,
        modifier: roll.input.modifier,
        total: result.total,
        success,
        advantage: roll.advantage,
        disadvantage: roll.disadvantage,
        notes: [...d20StepNotes(result.steps), ...roll.reminders].slice(0, 50),
      }),
    ];
    if (!success) ops.push(...this.endConcentration(playerId, character, 'failed_save'));
    return { ops, kept: success };
  }

  /**
   * Termina as condições com duração e os efeitos temporários cujo `until`
   * passa no teste (ou que `alsoEffect` manda terminar), com o registro no
   * chat. Devolve os efeitos que continuam e as operações.
   */
  private expire(
    combat: Combat,
    isOver: (until: TurnExpiry) => boolean,
    playerId: string,
    alsoEffect: (effect: TimedEffect) => boolean = () => false,
  ): { effects: TimedEffect[]; ops: PatchOp[] } {
    const ops: PatchOp[] = [];
    const prune = (state: ConditionState, path: string, target: { characterId: string } | { tokenId: string }, name: string): void => {
      const over = state.active.filter((c) => c.until !== undefined && isOver(c.until));
      if (over.length === 0) return;
      ops.push({ op: 'replace', path, value: { ...state, active: state.active.filter((c) => !over.includes(c)) } });
      for (const c of over) {
        ops.push(this.appendChat({ kind: 'condition_changed', ...this.entryBase(playerId), target, targetName: name, change: { kind: 'removed', condition: c.condition }, notes: ['Fim da duração'] }));
      }
    };
    for (const character of Object.values(this.current.characters)) {
      prune(character.conditions, toPointer('characters', character.id, 'conditions'), { characterId: character.id }, character.name);
    }
    for (const token of Object.values(this.current.tokens)) {
      if (token.characterId === null) prune(token.conditions, toPointer('tokens', token.id, 'conditions'), { tokenId: token.id }, token.name);
    }
    const effects: TimedEffect[] = [];
    for (const effect of combat.effects) {
      if (!isOver(effect.until) && !alsoEffect(effect)) {
        effects.push(effect);
        continue;
      }
      ops.push(this.appendChat(this.timedEffectEntry(playerId, 'ended', effect)));
    }
    return { effects, ops };
  }

  private timedEffectEntry(playerId: string, event: 'started' | 'ended', effect: TimedEffect): ChatEntry {
    const target = this.current.tokens[effect.targetTokenId];
    return {
      kind: 'timed_effect',
      ...this.entryBase(playerId),
      event,
      effect: effect.kind,
      sourceName: this.current.tokens[effect.sourceTokenId]?.name ?? 'Token removido',
      targetTokenId: effect.targetTokenId,
      targetName: target?.name ?? 'Token removido',
    };
  }

  // --- Maestrias de arma (Fase 4, PR 5) -------------------------------------

  /**
   * Usa a ação de seguimento da maestria de um `attack_roll` (uma vez por
   * ataque): Cleave ataca um segundo alvo, Graze causa o modificador de dano
   * no erro, Topple força a salvaguarda de Constituição contra Caído. A ficha
   * é recalculada: a arma precisa continuar equipada e com a maestria.
   */
  private useMastery(playerId: string, role: Role, data: IntentData<'mastery.use'>): PatchOp[] {
    const entry = this.current.chat.find((e) => e.id === data.entryId);
    if (entry?.kind !== 'attack_roll') throw violation('Ataque não encontrado no chat');
    if (role !== 'gm' && entry.authorId !== playerId) throw notAllowed('Só quem fez o ataque (ou o mestre) usa a maestria');
    const action = entry.mastery?.action;
    if (!entry.weapon || !entry.mastery || !action) throw violation('Este ataque não tem maestria para usar');
    if (this.current.chat.some((e) => 'masteryOf' in e && e.masteryOf === entry.id)) throw violation('A maestria deste ataque já foi usada');
    if (action !== 'cleave' && (data.targetTokenId !== undefined || data.advantage !== undefined || data.disadvantage !== undefined)) {
      throw violation('Alvo e Vantagem/Desvantagem só valem no Cleave');
    }
    const { character, sheet } = this.sheetOf(playerId, role, entry.weapon.characterId);
    const instanceId = entry.weapon.instanceId;
    const attack = sheet.attacks.find((a) => a.instanceId === instanceId);
    if (!attack?.mastery.available || attack.mastery.property !== entry.mastery.property) throw violation('A arma não está mais equipada com esta maestria');
    const abilityModifier = sheet.abilities[attack.ability].modifier;
    const name = MASTERY_NAME[entry.mastery.property];

    if (action === 'cleave') {
      if (data.targetTokenId === undefined) throw violation('Escolha o segundo alvo do Cleave');
      if (data.targetTokenId === entry.targetTokenId) throw violation('O Cleave precisa de outra criatura');
      return this.makeAttack(
        playerId,
        role,
        {
          attacker: entry.weapon,
          targetTokenId: data.targetTokenId,
          ...(data.advantage !== undefined ? { advantage: data.advantage } : {}),
          ...(data.disadvantage !== undefined ? { disadvantage: data.disadvantage } : {}),
          visibility: entry.visibility,
        },
        entry.id,
      );
    }

    const target = this.token(entry.targetTokenId);
    if (action === 'graze') {
      const amount = grazeDamage(abilityModifier);
      if (amount === 0) throw violation('Sem dano do Graze: o modificador de atributo não é positivo');
      const defender = this.targetOf(target);
      const applied = applyDamage(defender.defenses, [{ amount, type: attack.damage.type }], this.deps.rng);
      const base = this.entryBase(playerId);
      const proposalId = applied.total > 0 ? this.deps.newId() : undefined;
      return [
        this.appendChat({
          kind: 'mastery_damage',
          ...base,
          masteryOf: entry.id,
          property: 'graze',
          attackerName: character.name,
          label: attack.name.slice(0, 100),
          targetTokenId: target.id,
          targetName: target.name,
          visibility: entry.visibility,
          damageType: attack.damage.type,
          amount,
          total: applied.total,
          defenses: [...damageNotes(applied), ...defender.reminders].slice(0, 50),
          ...(proposalId ? { proposalId } : {}),
        }),
        ...(proposalId
          ? [{ op: 'add' as const, path: toPointer('proposals', proposalId), value: { id: proposalId, entryId: base.id, targetTokenId: target.id, targetName: target.name, amount: applied.total } }]
          : []),
      ];
    }

    // Topple: salvaguarda de Constituição contra Caído, sem dano.
    const dc = toppleDc(abilityModifier, sheet.proficiencyBonus);
    const save = this.saveOf(target, 'con', { condition: 'prone' });
    const result = resolveSave({ d20: save.input, dc, damage: [], onSuccess: 'none', defenses: save.defenses }, this.deps.rng);
    const immune = save.defenses.conditionImmunities.some((c) => c.condition === 'prone');
    const conditionNotes = result.success ? [] : [immune ? `Imune a ${CONDITION_NAME.prone}` : `Na falha: ${CONDITION_NAME.prone}`];
    return [
      this.appendChat({
        kind: 'save_roll',
        ...this.entryBase(playerId),
        actorName: character.name,
        label: `${name} (${attack.name})`.slice(0, 100),
        ability: 'con',
        dc,
        onSuccess: 'none',
        visibility: entry.visibility,
        conditions: ['prone'],
        masteryOf: entry.id,
        results: [
          {
            targetTokenId: target.id,
            targetName: target.name,
            mode: save.input.mode,
            dice: result.roll.dice,
            natural: result.roll.natural,
            modifier: save.input.modifier,
            total: result.roll.total,
            success: result.success,
            advantage: save.advantage,
            disadvantage: save.disadvantage,
            notes: [...d20StepNotes(result.roll.steps), ...conditionNotes].slice(0, 50),
            reminders: save.reminders.slice(0, 50),
          },
        ],
      }),
    ];
  }

  /** Aplica o dano proposto (ou o valor do mestre) nos PV do alvo e registra no chat. */
  private applyProposal(playerId: string, proposalId: string, override: number | undefined): PatchOp[] {
    const proposal = this.proposal(proposalId);
    const token = this.current.tokens[proposal.targetTokenId];
    if (!token) throw violation('O alvo não está mais no mapa');
    const amount = override ?? proposal.amount;
    let result: ReturnType<typeof applyHitPointChange>;
    let ops: PatchOp[];
    if (token.characterId !== null) {
      const character = this.current.characters[token.characterId];
      const sheet = character ? this.deps.characterSheet(character) : undefined;
      if (!character || !sheet) throw violation('O personagem do alvo ainda não tem ficha');
      // Dano de um Acerto Crítico com 0 PV conta duas falhas.
      const source = this.current.chat.find((e) => e.id === proposal.entryId);
      const critical = source?.kind === 'attack_roll' && source.critical;
      ({ result, ops } = this.changeCharacterHp(playerId, character, sheet, { kind: 'damage', amount }, critical));
    } else {
      if (!token.hp) throw violation('O alvo não tem PV (defina os PV máximos no painel)');
      result = applyHitPointChange(token.hp.max, token.hp, { kind: 'damage', amount });
      ops = [{ op: 'replace', path: toPointer('tokens', token.id, 'hp'), value: { max: token.hp.max, ...result.state } }];
    }
    const notes = [
      ...(result.absorbed > 0 ? [`${result.absorbed} absorvido(s) pelos PV temporários`] : []),
      ...(result.droppedToZero ? [`${token.name} caiu a 0 PV`] : []),
      ...(result.massiveDamage && token.characterId !== null ? ['Dano massivo: morte instantânea (SRD)'] : []),
      ...(result.damagedAtZero && token.characterId === null ? ['Dano com 0 PV'] : []),
    ];
    // O registro do dano vem antes das consequências (Inconsciente, falhas, morte).
    return [
      { op: 'remove', path: toPointer('proposals', proposalId) },
      this.appendChat({
        kind: 'damage_applied',
        ...this.entryBase(playerId),
        targetTokenId: token.id,
        targetName: token.name,
        amount,
        ...(override !== undefined && override !== proposal.amount ? { proposed: proposal.amount } : {}),
        notes,
      }),
      ...ops,
    ];
  }

  // --- Salvaguardas forçadas (Fase 4, PR 4) ---------------------------------

  /**
   * Um efeito com CD contra um ou mais tokens: o dano é rolado uma vez para
   * todos; cada alvo rola a própria salvaguarda (com as Vantagens
   * circunstanciais que batem com `against`); o dano de cada um, depois do
   * sucesso e das defesas, vira uma proposta para o mestre.
   */
  private forceSave(playerId: string, role: Role, data: IntentData<'save.force'>): PatchOp[] {
    let actorName: string;
    let effect: { name: string; ability: Ability; dc: number; damage: { dice: string; type: DamageType }[]; onSuccess: 'half' | 'none'; conditions: Condition[] };
    if ('tokenId' in data.source) {
      const token = this.token(data.source.tokenId);
      if (role !== 'gm' && !token.ownerIds.includes(playerId)) throw notAllowed('Você não controla este token');
      const actionId = data.source.actionId;
      const action = token.monsterId !== null ? this.deps.creature(token.monsterId)?.actions.find((a) => a.id === actionId) : undefined;
      if (action?.kind !== 'save') throw violation('Ação de salvaguarda não encontrada no bloco do monstro');
      actorName = token.name;
      effect = { name: action.name, ability: action.ability, dc: action.dc, damage: action.damage, onSuccess: action.onSuccess, conditions: action.onFailConditions };
    } else {
      actorName = this.current.players[playerId]?.displayName ?? 'Alguém';
      const custom = data.source.custom;
      effect = { ...custom, conditions: custom.conditions ?? [] };
    }
    const targets = data.targetTokenIds.map((id) => this.token(id));
    const against: RollAgainst | undefined = data.against ?? (effect.conditions[0] ? { condition: effect.conditions[0] } : undefined);

    // Dano rolado uma vez para todos os alvos (SRD 5.2.1, "Damage against Multiple Targets").
    const groups = rollActionDamage(effect.damage, false, this.deps.rng);
    const rolled = groups.map((g) => ({ amount: g.total, type: g.type }));
    const entryId = this.deps.newId();
    const ops: PatchOp[] = [];

    const results = targets.map((target) => {
      const save = this.saveOf(target, effect.ability, against);
      const result = resolveSave({ d20: save.input, dc: effect.dc, damage: rolled, onSuccess: effect.onSuccess, defenses: save.defenses }, this.deps.rng);
      const immune = new Set(save.defenses.conditionImmunities.map((c) => c.condition));
      const conditionNotes = result.success
        ? []
        : effect.conditions.map((c) => (immune.has(c) ? `Imune a ${CONDITION_NAME[c]}` : `Na falha: ${CONDITION_NAME[c]}`));
      let damage: { total: number; defenses: string[]; proposalId?: string } | undefined;
      if (result.damage) {
        damage = { total: result.damage.total, defenses: damageNotes(result.damage) };
        if (result.damage.total > 0) {
          const proposalId = this.deps.newId();
          damage.proposalId = proposalId;
          ops.push({ op: 'add', path: toPointer('proposals', proposalId), value: { id: proposalId, entryId, targetTokenId: target.id, targetName: target.name, amount: result.damage.total } });
        }
      }
      return {
        targetTokenId: target.id,
        targetName: target.name,
        mode: save.input.mode,
        dice: result.roll.dice,
        natural: result.roll.natural,
        modifier: save.input.modifier,
        total: result.roll.total,
        success: result.success,
        advantage: save.advantage,
        disadvantage: save.disadvantage,
        notes: [...d20StepNotes(result.roll.steps), ...conditionNotes].slice(0, 50),
        reminders: save.reminders.slice(0, 50),
        ...(damage ? { damage } : {}),
      };
    });

    const entry: ChatEntry = {
      kind: 'save_roll',
      id: entryId,
      at: this.deps.now(),
      authorId: playerId,
      actorName,
      label: effect.name.slice(0, 100),
      ability: effect.ability,
      dc: effect.dc,
      onSuccess: effect.onSuccess,
      visibility: data.visibility,
      ...(groups.length > 0 ? { damage: { groups, total: rolled.reduce((sum, d) => sum + d.amount, 0) } } : {}),
      conditions: effect.conditions,
      results,
    };
    return [this.appendChat(entry), ...ops];
  }

  /** A salvaguarda de um token: a da ficha do personagem ligado ou a do bloco do monstro, com as defesas dele. */
  private saveOf(token: Token, ability: Ability, against: RollAgainst | undefined): SheetD20 & { defenses: Defenses } {
    if (token.characterId !== null) {
      const character = this.current.characters[token.characterId];
      const sheet = character ? this.deps.characterSheet(character) : undefined;
      const roll = sheet ? sheetD20(sheet, { kind: 'save', ability }, {}, against) : undefined;
      if (!sheet || !roll) throw violation(`${token.name}: o personagem ainda não tem ficha`);
      return { ...roll, defenses: sheet.defenses };
    }
    const creature = token.monsterId !== null ? this.deps.creature(token.monsterId) : undefined;
    if (!creature) throw violation(`${token.name}: sem salvaguarda conhecida (não é personagem nem monstro do compêndio)`);
    const { defenses, reminders } = creatureDefenses(creature);
    const state = this.conditionsOf(token);
    // Bônus do bloco, com a Exaustão e as condições (Paralisado falha em FOR e DES).
    const roll = creatureD20({ label: 'Salvaguarda do bloco', modifier: creatureSaveBonus(creature, ability) }, state, { kind: 'save', ability });
    return { ...roll, reminders: [...roll.reminders, ...reminders], defenses: conditionDefenses(state.conditions, defenses) };
  }
}
