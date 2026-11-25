/**
 * Usos limitados das ações e traços de um monstro (nota 0064): quantos sobram e
 * a recarga. O bloco dá o máximo; o token guarda só os gastos. Sem
 * dependências de valor: a tela importa por `rules-engine/monster-uses`.
 *
 * SRD 5.2.1, "Limited Usage": "X/Day" volta no descanso longo e "Recharge X–Y"
 * é rolado (1d6) no início de cada turno do monstro, e também volta num descanso.
 */

export type MonsterUseLimit = { recharge: number } | { per: string; count: number; lairCount?: number | undefined };

export interface LimitedFeature {
  id: string;
  name: string;
  limit?: MonsterUseLimit | undefined;
}

/** Id dos usos por dia de uma magia no registro do token (nota 0067). */
export const monsterSpellUseId = (spellId: string): string => `spell_${spellId}`;

export const RECHARGE_DIE = 6;

/** Máximo de usos: 1 na recarga; por dia, o publicado (no covil, o do covil). */
export function monsterUseMax(limit: MonsterUseLimit, lair: boolean): number {
  if ('recharge' in limit) return 1;
  return lair ? (limit.lairCount ?? limit.count) : limit.count;
}

/** Usos disponíveis, nunca abaixo de 0 (o monstro pode sair do covil com mais gastos que o máximo). */
export function availableMonsterUses(feature: { id: string; limit: MonsterUseLimit }, uses: { spent: Readonly<Record<string, number>>; lair: boolean }): number {
  return Math.max(0, monsterUseMax(feature.limit, uses.lair) - (uses.spent[feature.id] ?? 0));
}

/** Os gastos com `delta` a mais (ou a menos) numa ação; zero sai do registro. */
export function withMonsterUse(spent: Readonly<Record<string, number>>, id: string, delta: number): Record<string, number> {
  const next = Math.max(0, (spent[id] ?? 0) + delta);
  return Object.fromEntries([...Object.entries(spent).filter(([key]) => key !== id), ...(next > 0 ? [[id, next] as const] : [])]);
}

/** As recargas gastas, a rolar no início do turno. */
export function pendingRecharges(features: readonly LimitedFeature[], spent: Readonly<Record<string, number>>): { id: string; name: string; min: number }[] {
  return features.flatMap(({ id, name, limit }) => (limit && 'recharge' in limit && (spent[id] ?? 0) > 0 ? [{ id, name, min: limit.recharge }] : []));
}
