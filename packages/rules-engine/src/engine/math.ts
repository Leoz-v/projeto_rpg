/**
 * Fórmulas e tabelas básicas do SRD 5.2.1 (Playing the Game, Character
 * Creation, Multiclassing).
 */

export const MAX_LEVEL = 20;

/** Modificador de atributo: (valor − 10) / 2, arredondado para baixo. */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** Bônus de proficiência pelo nível de personagem (+2 no 1, +6 no 17). */
export function proficiencyBonus(characterLevel: number): number {
  const level = Math.min(Math.max(characterLevel, 1), MAX_LEVEL);
  return 2 + Math.floor((level - 1) / 4);
}

/** PV fixos por nível depois do 1 (Fixed Hit Points by Class): metade do dado + 1. */
export function fixedHitPointsPerLevel(hitDie: number): number {
  return hitDie / 2 + 1;
}

/**
 * Espaços de magia por nível de conjurador (tabela Multiclass Spellcaster, que
 * coincide com a dos conjuradores plenos). Índice 0 = nível de conjurador 1;
 * cada linha lista os espaços dos níveis de magia 1 a 9.
 */
const SPELL_SLOTS: readonly (readonly number[])[] = [
  [2, 0, 0, 0, 0, 0, 0, 0, 0],
  [3, 0, 0, 0, 0, 0, 0, 0, 0],
  [4, 2, 0, 0, 0, 0, 0, 0, 0],
  [4, 3, 0, 0, 0, 0, 0, 0, 0],
  [4, 3, 2, 0, 0, 0, 0, 0, 0],
  [4, 3, 3, 0, 0, 0, 0, 0, 0],
  [4, 3, 3, 1, 0, 0, 0, 0, 0],
  [4, 3, 3, 2, 0, 0, 0, 0, 0],
  [4, 3, 3, 3, 1, 0, 0, 0, 0],
  [4, 3, 3, 3, 2, 0, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

/** Espaços por nível de magia (1–9) para um nível de conjurador; 0 = nenhum. */
export function spellSlots(casterLevel: number): number[] {
  if (casterLevel < 1) return [0, 0, 0, 0, 0, 0, 0, 0, 0];
  return [...(SPELL_SLOTS[Math.min(casterLevel, MAX_LEVEL) - 1] ?? [])];
}

/** Contribuição de uma classe para o nível de conjurador (`full` inteiro, `half` metade para cima). */
export function casterLevelContribution(progression: 'full' | 'half', classLevel: number): number {
  return progression === 'full' ? classLevel : Math.ceil(classLevel / 2);
}

/**
 * Magia de Pacto (tabela Warlock Features): quantidade e nível dos espaços por
 * nível de Bruxo. Todos os espaços são do mesmo nível.
 */
const PACT_SLOTS: readonly (readonly [count: number, level: number])[] = [
  [1, 1], [2, 1], [2, 2], [2, 2], [2, 3], [2, 3], [2, 4], [2, 4], [2, 5], [2, 5],
  [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [4, 5], [4, 5], [4, 5], [4, 5],
];

export function pactMagicSlots(warlockLevel: number): { count: number; level: number } | undefined {
  const row = PACT_SLOTS[Math.min(warlockLevel, MAX_LEVEL) - 1];
  return row ? { count: row[0], level: row[1] } : undefined;
}

/** Penalidade da Exaustão por nível: −2 em testes d20 e −5 ft de deslocamento. */
export const EXHAUSTION_D20_PENALTY = 2;
export const EXHAUSTION_SPEED_PENALTY = 5;
export const MAX_EXHAUSTION = 6;
