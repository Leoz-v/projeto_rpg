import { concentrationDc, d20StepNotes, effectiveConditions, rollD20 } from 'rules-engine';
import { type ChatEntry, type ConditionState, type PatchOp, type Token, toPointer } from '../../shared/protocol';
import { saveOf } from './attacks';
import { type SessionContext, violation } from './context';
import { liftSpellConditions } from './spell-effects';

/** Concentração dos monstros (nota 0068), com as regras da dos personagens (nota 0045). Funções do executor da sessão (`HostSession`), sobre o `SessionContext`. */

/** Passa a se concentrar na magia; a anterior termina. A mesma magia de novo mantém. */
export function concentrateToken(ctx: SessionContext, playerId: string, token: Token, spell: { id: string; name: string }): PatchOp[] {
  if (effectiveConditions(token.conditions.active.map((c) => c.condition)).has('incapacitated')) throw violation(`${token.name} está Incapacitado`);
  if (token.concentration?.spellId === spell.id) return [];
  const name = spell.name.slice(0, 100);
  return [
    ...endTokenConcentration(ctx, playerId, token, 'replaced'),
    { op: 'replace', path: toPointer('tokens', token.id, 'concentration'), value: { spellId: spell.id, name } },
    ctx.appendChat({ kind: 'concentration', ...ctx.entryBase(playerId), tokenId: token.id, characterName: token.name, spellName: name, event: 'started', notes: [] }),
  ];
}

/** Encerra a Concentração e o que a magia mantinha. `own`: as condições do token, se a mesma ação acabou de mudá-las. */
export function endTokenConcentration(
  ctx: SessionContext,
  playerId: string,
  token: Token,
  reason: NonNullable<Extract<ChatEntry, { kind: 'concentration' }>['reason']>,
  own: ConditionState = token.conditions,
): PatchOp[] {
  if (!token.concentration) return [];
  const { spellId, name } = token.concentration;
  return [
    { op: 'replace', path: toPointer('tokens', token.id, 'concentration'), value: null },
    ctx.appendChat({ kind: 'concentration', ...ctx.entryBase(playerId), tokenId: token.id, characterName: token.name, spellName: name, event: 'ended', reason, notes: [] }),
    ...liftSpellConditions(ctx, playerId, { tokenId: token.id, spellId }, name, own),
  ];
}

/** Incapacitado (ou o que o inclui) encerra. */
export function tokenConcentrationBreaks(ctx: SessionContext, playerId: string, token: Token, conditions: ConditionState): PatchOp[] {
  if (!token.concentration || !effectiveConditions(conditions.active.map((c) => c.condition)).has('incapacitated')) return [];
  return endTokenConcentration(ctx, playerId, token, 'incapacitated', conditions);
}

/** Dano num monstro concentrado: com 0 PV, a Concentração termina; senão, salvaguarda de Constituição. */
export function tokenDamaged(ctx: SessionContext, playerId: string, token: Token, hp: { max: number; damage: number }, damage: number): PatchOp[] {
  if (!token.concentration || damage <= 0) return [];
  if (hp.damage >= hp.max) return endTokenConcentration(ctx, playerId, token, 'dead');
  // Sem bloco, não há salvaguarda a rolar: o mestre decide.
  if (!ctx.creatureOf(token)) return [];
  const dc = concentrationDc(damage);
  const save = saveOf(ctx, token, 'con', undefined);
  const result = rollD20({ ...save.input, dc }, ctx.deps.rng);
  const success = result.success === true;
  return [
    ctx.appendChat({
      kind: 'concentration_save',
      ...ctx.entryBase(playerId),
      tokenId: token.id,
      characterName: token.name,
      spellName: token.concentration.name,
      dc,
      mode: save.input.mode,
      dice: result.dice,
      natural: result.natural,
      modifier: save.input.modifier,
      total: result.total,
      success,
      advantage: save.advantage,
      disadvantage: save.disadvantage,
      notes: [...d20StepNotes(result.steps), ...save.reminders].slice(0, 50),
    }),
    ...(success ? [] : endTokenConcentration(ctx, playerId, token, 'failed_save')),
  ];
}
