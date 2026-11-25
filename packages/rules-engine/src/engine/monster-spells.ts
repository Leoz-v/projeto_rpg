import type { Ability } from '../schemas/common';
import type { Creature } from '../schemas/creature';
import { abilityModifier } from './math';
import { monsterSpellUseId } from './monster-uses';

/**
 * Magias de monstro (nota 0067). SRD 5.2.1, "Monsters", Spellcasting: a CD e o
 * bônus vêm do bloco, e a magia é conjurada no menor círculo, salvo o que o
 * bloco diz ("level 3 version"). Sem espaços de magia.
 */
export interface MonsterSpell {
  spellId: string;
  ability: Ability;
  modifier: number;
  saveDc: number;
  attackBonus: number;
  /** Círculo fixado pelo bloco. */
  level?: number | undefined;
  note?: string | undefined;
  /** Usos por dia; ausente, à vontade. */
  use?: { id: string; perDay: number } | undefined;
}

/** CD = 8 + bônus de ataque de magia (os dois somam proficiência e atributo). */
const DC_BASE = 8;

export function monsterSpells(creature: Creature): MonsterSpell[] {
  return creature.actions.flatMap((action): MonsterSpell[] => {
    if (action.kind !== 'spellcasting') return [];
    const modifier = abilityModifier(creature.abilities[action.ability]);
    // Um dos dois pode faltar no bloco: o outro dá a conta.
    const attackBonus = action.toHit ?? (action.dc !== undefined ? action.dc - DC_BASE : modifier);
    const saveDc = action.dc ?? DC_BASE + attackBonus;
    return action.spells.map((s) => ({
      spellId: s.spellId,
      ability: action.ability,
      modifier,
      saveDc,
      attackBonus,
      level: s.level,
      note: s.note,
      use: s.uses === 'at_will' ? undefined : { id: monsterSpellUseId(s.spellId), perDay: s.uses.count },
    }));
  });
}
