import { describe, expect, it } from 'vitest';
import { monsterSpells } from '../../src/engine';
import { loadSrdCompendium } from '../../src/srd';

const srd = loadSrdCompendium();
const spellsOf = (id: string) => {
  const creature = srd.creatures.find((c) => c.id === id);
  if (!creature) throw new Error(id);
  return monsterSpells(creature);
};

describe('monster spells (note 0067)', () => {
  it('DC, attack, level and uses come from the block', () => {
    expect(spellsOf('adult_red_dragon').find((s) => s.spellId === 'scorching_ray')).toMatchObject({ saveDc: 20, attackBonus: 12, use: undefined });
    expect(spellsOf('lich').find((s) => s.spellId === 'fireball')).toMatchObject({ ability: 'int', saveDc: 20, level: 5, use: undefined });
    expect(spellsOf('lich').find((s) => s.spellId === 'chain_lightning')?.use).toEqual({ id: 'spell_chain_lightning', perDay: 1 });
    expect(spellsOf('mage').find((s) => s.spellId === 'mage_armor')?.note).toBe('included in AC');
    expect(spellsOf('wolf')).toEqual([]);
  });

  it('every monster spell is in the compendium, and the structured ones have a published DC or attack bonus', () => {
    for (const creature of srd.creatures) {
      for (const action of creature.actions) {
        if (action.kind !== 'spellcasting') continue;
        for (const s of action.spells) {
          const spell = srd.spells.find((x) => x.id === s.spellId);
          expect(spell, `${creature.id}/${s.spellId}`).toBeDefined();
          if (spell?.resolution.some((p) => p.kind === 'attack' || p.kind === 'save')) expect(action.dc ?? action.toHit, creature.id).toBeDefined();
        }
      }
    }
  });
});
