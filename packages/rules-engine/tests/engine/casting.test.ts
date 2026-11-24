import { describe, expect, it } from 'vitest';
import type { CharacterInput } from '../../src/schemas/character';
import elfWizard from '../fixtures/elf-wizard-7.json';
import { spellAttackD20 } from '../../src/engine/sheet-roll';
import { derive } from './helpers';

/** Magias conjuráveis e magias concedidas com usos por descanso (nota 0053). */
describe('castable spells', () => {
  const { character } = elfWizard as unknown as { character: Pick<CharacterInput, 'steps' | 'baseScores'> };
  const sheet = derive({ steps: character.steps, baseScores: character.baseScores });
  const castable = (id: string) => sheet.spellcasting.castable.find((c) => c.spellId === id);

  it('cantrips are free; class spells use slots', () => {
    expect(castable('fire_bolt')).toMatchObject({ spellId: 'fire_bolt', level: 0, ritual: false, concentration: false, slots: false, free: 'cantrip' });
    expect(castable('magic_missile')).toMatchObject({ spellId: 'magic_missile', level: 1, ritual: false, concentration: false, slots: true, free: undefined });
    expect(castable('fly')).toMatchObject({ level: 3, concentration: true, slots: true });
  });

  it('a spell granted once per Long Rest that is also a class spell: a free use and the slots', () => {
    // Misty Step: linhagem élfica (1 vez por Descanso Longo) e grimório do Mago.
    expect(castable('misty_step')).toMatchObject({ level: 2, slots: true, free: { resourceId: 'spell_misty_step' } });
    expect(sheet.resources.find((r) => r.id === 'spell_misty_step')).toMatchObject({ name: 'Misty Step', max: 1, recharge: 'long_rest' });
  });

  it('keeps the ritual tag', () => {
    expect(castable('detect_magic')).toMatchObject({ level: 1, ritual: true, concentration: true });
  });

  it('each castable spell says the ability, the save DC and the attack bonus (nota 0055)', () => {
    // INT 18 (+4), proficiência +3: CD 15, ataque +7.
    const casters = castable('fire_bolt')?.casters ?? [];
    expect(casters.map((c) => [c.ability, c.saveDc, c.attack.total])).toEqual([['int', 15, 7]]);
    const wizard = sheet.spellcasting.classes[0];
    expect(wizard?.saveDc.total).toBe(15);
    expect(wizard?.attack.total).toBe(7);
  });

  it('a spell from two sources keeps both abilities, the higher DC first', () => {
    const casters = castable('misty_step')?.casters ?? [];
    expect(casters.map((c) => c.ability)).toContain('int');
    expect(casters.map((c) => c.saveDc)).toEqual([...casters.map((c) => c.saveDc)].sort((a, b) => b - a));
  });

  it('spell attacks use the sheet d20 state (Poisoned gives Disadvantage)', () => {
    expect(sheet.spellcasting.attackRoll.mode).toBe('normal');
    const poisoned = derive({ steps: character.steps, baseScores: character.baseScores, conditions: { active: [{ condition: 'poisoned' }], exhaustion: 0 } });
    expect(poisoned.spellcasting.attackRoll.mode).toBe('disadvantage');
    const caster = poisoned.spellcasting.castable.find((c) => c.spellId === 'fire_bolt')?.casters[0];
    if (!caster) throw new Error('sem conjurador');
    expect(spellAttackD20(poisoned, caster, { advantage: true }).input).toMatchObject({ modifier: 7, mode: 'normal' });
  });

  it('a character without spells has nothing to cast', () => {
    expect(derive({}).spellcasting.castable).toEqual([]);
  });
});
