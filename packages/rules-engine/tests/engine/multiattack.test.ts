import { describe, expect, it } from 'vitest';
import { multiattackFits, multiattackSlots } from '../../src/engine/multiattack';
import { monsterSpells, monsterSpellUseId } from '../../src/engine';
import { loadSrdCompendium } from '../../src/srd';

const srd = loadSrdCompendium();
const multi = (id: string) => {
  const action = srd.creatures.find((c) => c.id === id)?.actions.find((a) => a.kind === 'text' && a.multiattack);
  if (action?.kind !== 'text' || !action.multiattack) throw new Error(`${id} sem Multiattack`);
  return action.multiattack;
};

describe('Multiattack (note 0066)', () => {
  it('fixed attacks, in any order and possibly fewer', () => {
    const fiend = multi('pit_fiend');
    expect(multiattackFits(fiend, 0, ['fiery_mace', 'devilish_claw', 'bite', 'devilish_claw'])).toBe(true);
    expect(multiattackFits(fiend, 0, ['bite'])).toBe(true);
    expect(multiattackFits(fiend, 0, ['bite', 'bite'])).toBe(false);
    expect(multiattackFits(fiend, 0, [])).toBe(false);
    expect(multiattackFits(fiend, 3, ['bite'])).toBe(false);
  });

  it('any combination, and separate options', () => {
    expect(multiattackFits(multi('assassin'), 0, ['shortsword', 'light_crossbow', 'shortsword'])).toBe(true);
    expect(multiattackFits(multi('assassin'), 0, ['shortsword', 'shortsword', 'shortsword', 'shortsword'])).toBe(false);
    const medusa = multi('medusa');
    expect(multiattackFits(medusa, 0, ['claw', 'claw', 'snake_hair'])).toBe(true);
    expect(multiattackFits(medusa, 0, ['claw', 'poison_ray'])).toBe(false);
    expect(multiattackFits(medusa, 1, ['poison_ray', 'poison_ray', 'poison_ray'])).toBe(true);
    expect(multiattackFits(multi('tarrasque'), 0, ['claw', 'tail', 'claw', 'bite'])).toBe(true);
    expect(multiattackFits(multi('tarrasque'), 0, ['bite', 'bite'])).toBe(false);
  });

  it('replacements: how many, which attack and what they cost', () => {
    const turtle = multi('dragon_turtle');
    expect(multiattackFits(turtle, 0, ['bite', 'tail', 'bite'])).toBe(true);
    expect(multiattackFits(turtle, 0, ['tail', 'tail', 'bite'])).toBe(false);
    // Sleep Breath no lugar de dois ataques.
    const brass = multi('young_brass_dragon');
    expect(multiattackFits(brass, 0, ['sleep_breath', 'rend'])).toBe(true);
    expect(multiattackFits(brass, 0, ['sleep_breath', 'rend', 'rend'])).toBe(false);
    // Só a garra vira sopro.
    const chimera = multi('chimera');
    expect(multiattackFits(chimera, 0, ['ram', 'bite', 'fire_breath'])).toBe(true);
    expect(multiattackFits(chimera, 0, ['bite', 'claw', 'fire_breath'])).toBe(false);
    expect(multiattackFits(multi('guardian_naga'), 0, ['poisonous_spittle', 'poisonous_spittle'])).toBe(true);
    expect(multiattackSlots(chimera, 0).map((s) => s.replacements)).toEqual([[], [], ['fire_breath']]);
  });

  it('replacements by a spell of the block', () => {
    const red = multi('adult_red_dragon');
    expect(multiattackFits(red, 0, ['rend', 'spell_scorching_ray', 'rend'])).toBe(true);
    expect(multiattackFits(red, 0, ['spell_scorching_ray', 'spell_scorching_ray'])).toBe(false);
    expect(multiattackFits(red, 0, ['spell_fireball'])).toBe(false);
    expect(multi('adult_bronze_dragon').replace?.actions).toEqual(['repulsion_breath', 'spell_guiding_bolt']);
    expect(multi('oni').replace?.actions.every((id) => id.startsWith('spell_'))).toBe(true);
    expect(multi('dryad').options[0]?.steps).toHaveLength(2);
  });

  it('every structured Multiattack uses attack or save actions of its own block', () => {
    let count = 0;
    let legendary = 0;
    for (const creature of srd.creatures) {
      const usable = new Set(creature.actions.filter((a) => a.kind === 'attack' || a.kind === 'save').map((a) => a.id));
      for (const s of monsterSpells(creature)) usable.add(monsterSpellUseId(s.spellId));
      for (const a of creature.actions) {
        if (a.kind !== 'text' || !a.multiattack) continue;
        if (a.activation === 'legendary') legendary++;
        else count++;
        const ids = [...a.multiattack.options.flatMap((o) => o.steps.flatMap((s) => s.actions)), ...(a.multiattack.replace?.actions ?? [])];
        expect(ids.filter((id) => !usable.has(id)), creature.id).toEqual([]);
        a.multiattack.options.forEach((o, i) => {
          expect(multiattackFits(a.multiattack ?? { options: [] }, i, o.steps.flatMap((s) => Array.from({ length: s.count }, () => s.actions[0] ?? ''))), creature.id).toBe(true);
        });
      }
    }
    expect(count).toBe(177);
    expect(legendary).toBe(51);
  });
});
