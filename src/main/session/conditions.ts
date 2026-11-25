import { CONDITION_NAME, nextTurnRound, type TurnExpiry, withoutDependents } from 'rules-engine';
import { type ChatEntry, type ConditionState, type TableCondition, type Intent, type IntentData, type PatchOp, type Role, type SessionCharacter, MAX_EXHAUSTION_LEVEL, toPointer } from '../../shared/protocol';
import { type SessionContext, violation, notAllowed } from './context';
import { tokenConcentrationBreaks } from './monster-concentration';
import { concentrationBreaks, deathStateEntry } from './vitality';

/** Condições, Exaustão e durações por turno (notas 0040 e 0042). Funções do executor da sessão (`HostSession`), sobre o `SessionContext`. */

/**
 * Onde ficam as condições do alvo: no personagem (também quando o alvo é o
 * token dele) ou no próprio token. Quem pode: o mestre, o dono do personagem
 * e os donos do token, como nos PV.
 */
export function conditionHolder(
  ctx: SessionContext,
  playerId: string,
  role: Role,
  target: IntentData<'condition.add'>['target'],
): { path: string; state: ConditionState; name: string; immune: ReadonlySet<string>; logTarget: { characterId: string } | { tokenId: string } } {
  let character: SessionCharacter | undefined;
  if ('characterId' in target) {
    character = ctx.ownCharacter(playerId, role, target.characterId);
  } else {
    const token = ctx.token(target.tokenId);
    if (token.characterId !== null) {
      const linked = ctx.current.characters[token.characterId];
      if (!linked) throw violation('Personagem do token não encontrado');
      if (role !== 'gm' && !ctx.controls(playerId, token)) throw notAllowed('Você não controla este token');
      character = linked;
    } else {
      if (role !== 'gm' && !token.ownerIds.includes(playerId)) throw notAllowed('Você não controla este token');
      const defenses = ctx.creatureOf(token)?.defenses;
      // Do bloco, e as que vêm das condições (Petrificado é imune a Envenenado).
      const immune = new Set<string>(defenses ? defenses.conditionImmunities.map((c) => c.condition) : ctx.conditionsOf(token).conditions.has('petrified') ? ['poisoned'] : []);
      return { path: toPointer('tokens', token.id, 'conditions'), state: token.conditions, name: token.name, immune, logTarget: { tokenId: token.id } };
    }
  }
  const sheet = ctx.deps.characterSheet(character);
  const immune = new Set<string>(sheet ? sheet.defenses.conditionImmunities.map((c) => c.condition) : []);
  return { path: toPointer('characters', character.id, 'conditions'), state: character.conditions, name: character.name, immune, logTarget: { characterId: character.id } };
}

/** Notas das condições que saíram junto com `condition`. */
function endedTogether(before: ConditionState['active'], after: ConditionState['active'], condition: TableCondition): string[] {
  return before.filter((c) => c.condition !== condition && !after.some((a) => a.condition === c.condition)).map((c) => `Também acabou: ${CONDITION_NAME[c.condition]}`);
}

export function changeConditions(ctx: SessionContext, playerId: string, role: Role, intent: Extract<Intent, { kind: 'condition.add' | 'condition.remove' | 'exhaustion.set' }>): PatchOp[] {
  const holder = conditionHolder(ctx, playerId, role, intent.data.target);
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
      const until = intent.data.until ? untilNextTurn(ctx, intent.data.until.at, intent.data.until.tokenId) : undefined;
      state = { ...holder.state, active: [...holder.state.active, { condition, ...(until ? { until } : {}) }] };
      change = { kind: 'added', condition };
    } else {
      if (!has) throw violation(`${holder.name} não está ${CONDITION_NAME[condition]}`);
      state = { ...holder.state, active: withoutDependents(holder.state.active.filter((c) => c.condition !== condition)) };
      notes.push(...endedTogether(holder.state.active, state.active, condition));
      change = { kind: 'removed', condition };
    }
  }
  const ops: PatchOp[] = [
    { op: 'replace', path: holder.path, value: state },
    ctx.appendChat({ kind: 'condition_changed', ...ctx.entryBase(playerId), target: holder.logTarget, targetName: holder.name, change, notes }),
  ];
  // Exaustão 6 mata: no personagem, o estado das Salvaguardas contra a Morte registra a morte.
  const character = 'characterId' in holder.logTarget ? ctx.current.characters[holder.logTarget.characterId] : undefined;
  let deathSaves = character?.deathSaves;
  if (character && change.kind === 'exhaustion' && change.to >= MAX_EXHAUSTION_LEVEL && !character.deathSaves.dead) {
    deathSaves = { ...character.deathSaves, dead: true };
    ops.push({ op: 'replace', path: toPointer('characters', character.id, 'deathSaves'), value: deathSaves });
    ops.push(deathStateEntry(ctx, playerId, character, 'exhaustion', deathSaves, [`Exaustão ${MAX_EXHAUSTION_LEVEL}: morto`]));
  }
  // Incapacitado (ou o que o inclui) ou morto: a Concentração termina.
  if ('tokenId' in holder.logTarget) ops.push(...tokenConcentrationBreaks(ctx, playerId, ctx.token(holder.logTarget.tokenId), state));
  if (character && deathSaves) ops.push(...concentrationBreaks(ctx, playerId, character, state, deathSaves));
  return ops;
}

/** Duração até o início ou o fim do próximo turno do combatente (precisa de combate com ele). */
export function untilNextTurn(ctx: SessionContext, at: TurnExpiry['at'], tokenId: string): TurnExpiry {
  const combat = ctx.current.combat;
  if (!combat) throw violation('Duração por turno só com combate em andamento');
  const index = combat.combatants.findIndex((c) => c.tokenId === tokenId);
  if (index < 0) throw violation('A duração precisa de um combatente do combate');
  return { at, tokenId, round: nextTurnRound(combat, index) };
}
