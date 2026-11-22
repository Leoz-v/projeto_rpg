import type { Effect } from '../schemas/effect';
import type { Weapon } from '../schemas/item';

/**
 * Proficiência com uma arma: pelo id da arma ou pela categoria (`simple`/`martial`),
 * respeitando o filtro de propriedades da concessão (ex.: "marciais Leves").
 */
export function isWeaponProficient(effects: readonly { effect: Effect }[], weapon: Weapon): boolean {
  return effects.some(({ effect }) => {
    if (effect.type !== 'grant_proficiency' || effect.category !== 'weapon') return false;
    if (effect.id === weapon.id) return true;
    if (effect.id !== weapon.category) return false;
    return effect.properties === undefined || effect.properties.some((p) => weapon.properties.includes(p));
  });
}
