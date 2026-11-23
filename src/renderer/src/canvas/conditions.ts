import { type ConditionState, NO_CONDITIONS, type SessionState, type Token } from '../../../shared/protocol';
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
