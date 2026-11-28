import { type ConditionState, NO_CONDITIONS, type SessionState, type Token } from '../../../shared/protocol';

/** Efeitos temporários das maestrias, como aparecem acima do token. */
const TIMED_LABEL = { sap: 'Sap', vex: 'Vex', slow: 'Slow −10 ft', stunning: 'Stunning Strike' } as const;
import { CONDITION_LABEL } from '../components/sheet-labels';

/** As condições que valem para o token: as do personagem que ele representa, ou as dele. */
export function tokenConditions(token: Token, characters: SessionState['characters']): ConditionState {
  if (token.characterId === null) return token.conditions;
  return characters[token.characterId]?.conditions ?? NO_CONDITIONS;
}

/** Nomes em pt-BR, na ordem em que entraram, com a Exaustão por último ("Caído", "Exaustão 2"). */
export function conditionLabels(state: ConditionState): string[] {
  return [...state.active.map((c) => CONDITION_LABEL[c.condition]), ...(state.exhaustion > 0 ? [`${CONDITION_LABEL.exhaustion} ${state.exhaustion}`] : [])];
}

/** Efeitos temporários que pesam sobre o token (Sap, Slow; Vex com quem o marcou). */
export function timedEffectLabels(token: Token, state: Pick<SessionState, 'combat' | 'tokens'>): string[] {
  return (state.combat?.effects ?? [])
    .filter((e) => e.targetTokenId === token.id)
    .map((e) => (e.kind === 'vex' ? `Vex (${state.tokens[e.sourceTokenId]?.name ?? '?'})` : TIMED_LABEL[e.kind]));
}

/** Nomes dos efeitos de magia sobre o token (num personagem, os ajustes ligados a magias). */
export function spellEffectLabels(token: Token, characters: SessionState['characters']): string[] {
  const list = token.characterId === null ? token.spellEffects : (characters[token.characterId]?.adjustments ?? []).filter((a) => a.spell);
  return list.map((e) => e.name);
}

/** Combatentes do combate em andamento, para escolher a duração de uma condição. */
export function combatantOptions(state: Pick<SessionState, 'combat' | 'tokens'>): { tokenId: string; name: string }[] {
  return (state.combat?.combatants ?? []).map((c) => ({ tokenId: c.tokenId, name: state.tokens[c.tokenId]?.name ?? 'Fora da visão' }));
}
