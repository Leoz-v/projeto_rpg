import { type Condition, type Creature, type DerivedSheet, distanceFeet, effectiveConditions, type Rng, type Size, spaceSquares, type Spell } from 'rules-engine';
import type { z } from 'zod';
import { type ChatEntry, type Combat, NO_CONDITIONS, type GameMap, type IntentRejectCode, type IntentResultSchema, type PatchOp, type Point, type Role, type SessionCharacter, type SessionState, type Token, WORLD_UNITS_PER_CELL } from '../../shared/protocol';

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
  /** Magia do compêndio (nome, círculo, texto): Concentração e conjurar. */
  spell(spellId: string): Spell | undefined;
}

export type InventoryEntry = SessionCharacter['inventory']['items'][number];
export const EMPTY_INVENTORY: SessionCharacter['inventory'] = { currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 }, items: [] };

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

export class Rejection extends Error {
  constructor(
    readonly code: IntentRejectCode,
    message: string,
  ) {
    super(message);
  }
}

export const notAllowed = (message: string): Rejection => new Rejection('not_allowed', message);
export const violation = (message: string): Rejection => new Rejection('rule_violation', message);

/**
 * Estado e auxiliares comuns do executor da sessão. A `HostSession` estende
 * esta classe; as áreas (mapa, personagens, PV, condições, combate, ataques)
 * são funções que recebem o contexto. Só a `HostSession` atribui `current`.
 */
export class SessionContext {
  /** Estado completo (visão do mestre). */
  current!: SessionState;

  constructor(readonly deps: SessionDeps) {}

  requireGm(role: Role): void {
    if (role !== 'gm') throw notAllowed('Só o mestre pode fazer isso');
  }

  map(mapId: string): GameMap {
    const map = this.current.maps[mapId];
    if (!map) throw violation('Mapa não encontrado');
    return map;
  }

  token(tokenId: string): Token {
    const token = this.current.tokens[tokenId];
    if (!token) throw violation('Token não encontrado');
    return token;
  }

  /** O token inteiro precisa caber no mapa: canto em `p` mais o espaço do tamanho (SRD: Large ocupa 2×2). */
  requireInside(map: GameMap, p: Point, size: Size): void {
    const side = spaceSquares(size) * WORLD_UNITS_PER_CELL;
    if (p.x + side > map.width * WORLD_UNITS_PER_CELL || p.y + side > map.height * WORLD_UNITS_PER_CELL) throw violation('Posição fora do mapa');
  }

  entryBase(playerId: string): Pick<ChatEntry, 'id' | 'at' | 'authorId'> {
    return { id: this.deps.newId(), at: this.deps.now(), authorId: playerId };
  }

  appendChat(entry: ChatEntry): PatchOp {
    return { op: 'add', path: '/chat/-', value: entry };
  }

  requireAsset(sha256: string | undefined): void {
    if (sha256 !== undefined && !this.deps.assetExists(sha256)) throw violation('Imagem não encontrada no Host');
  }

  /** O personagem, se quem pede é o dono ou o mestre. */
  ownCharacter(playerId: string, role: Role, characterId: string): SessionCharacter {
    const character = this.current.characters[characterId];
    if (!character) throw violation('Personagem não encontrado');
    if (role !== 'gm' && character.ownerId !== playerId) throw notAllowed('Este personagem não é seu');
    return character;
  }

  /** A ficha do personagem, se quem pede pode rolar por ele (dono ou mestre). */
  sheetOf(playerId: string, role: Role, characterId: string): { character: SessionCharacter; sheet: DerivedSheet } {
    const character = this.ownCharacter(playerId, role, characterId);
    const sheet = this.deps.characterSheet(character);
    if (!sheet) throw violation('O personagem ainda não tem ficha (defina os atributos)');
    return { character, sheet };
  }

  combat(): Combat {
    if (!this.current.combat) throw violation('Não há combate em andamento');
    return this.current.combat;
  }

  combatant(tokenId: string): number {
    const index = this.combat().combatants.findIndex((c) => c.tokenId === tokenId);
    if (index < 0) throw violation('Este token não está no combate');
    return index;
  }

  /** O combate inteiro vai num `replace` (é pequeno, e a visibilidade filtra o valor todo, seção 2.12). */
  replaceCombat(combat: Combat | null): PatchOp {
    return { op: 'replace', path: '/combat', value: combat };
  }

  /** O jogador controla o token: dono do token ou do personagem que ele representa. */
  controls(playerId: string, token: Token): boolean {
    if (token.ownerIds.includes(playerId)) return true;
    return token.characterId !== null && this.current.characters[token.characterId]?.ownerId === playerId;
  }

  /** Condições que valem para o token (as do personagem, num token de personagem), com as implícitas. */
  conditionsOf(token: Token): { conditions: Set<Condition>; exhaustion: number } {
    const state = token.characterId !== null ? (this.current.characters[token.characterId]?.conditions ?? NO_CONDITIONS) : token.conditions;
    return { conditions: effectiveConditions(state.active.map((c) => c.condition)), exhaustion: state.exhaustion };
  }

  /** Distância em pés entre dois tokens do mesmo mapa (motor); `undefined` sem o atacante no mapa do alvo. */
  distanceBetween(a: Token | undefined, b: Token): number | undefined {
    if (!a || a.mapId !== b.mapId) return undefined;
    const footprint = (t: Token) => ({ x: t.position.x / WORLD_UNITS_PER_CELL, y: t.position.y / WORLD_UNITS_PER_CELL, size: t.size });
    return distanceFeet(footprint(a), footprint(b));
  }

  /** Tira o personagem do descanso em andamento (dano interrompe; SRD 5.2.1, "Short Rest"); o último a sair encerra o descanso. */
  leaveRest(playerId: string, character: SessionCharacter, note: string): PatchOp[] {
    const rest = this.current.rest;
    if (!rest?.characterIds.includes(character.id)) return [];
    const characterIds = rest.characterIds.filter((id) => id !== character.id);
    return [
      { op: 'replace', path: '/rest', value: characterIds.length > 0 ? { ...rest, characterIds } : null },
      this.appendChat({ kind: 'rest', ...this.entryBase(playerId), event: 'interrupted', rest: rest.kind, characters: [{ characterId: character.id, name: character.name }], notes: [note] }),
    ];
  }
}
