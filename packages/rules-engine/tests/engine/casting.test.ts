import { describe, expect, it } from 'vitest';
import type { CharacterInput } from '../../src/schemas/character';
import elfWizard from '../fixtures/elf-wizard-7.json';
import { derive } from './helpers';

/** Magias conjuráveis e magias concedidas com usos por descanso (nota 0053). */
describe('castable spells', () => {
  const { character } = elfWizard as unknown as { character: Pick<CharacterInput, 'steps' | 'baseScores'> };
  const sheet = derive({ steps: character.steps, baseScores: character.baseScores });
  const castable = (id: string) => sheet.spellcasting.castable.find((c) => c.spellId === id);

  it('cantrips are free; class spells use slots', () => {
    expect(castable('fire_bolt')).toEqual({ spellId: 'fire_bolt', level: 0, ritual: false, concentration: false, slots: false, free: 'cantrip' });
    expect(castable('magic_missile')).toEqual({ spellId: 'magic_missile', level: 1, ritual: false, concentration: false, slots: true, free: undefined });
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

  it('a character without spells has nothing to cast', () => {
    expect(derive({}).spellcasting.castable).toEqual([]);
  });
});
