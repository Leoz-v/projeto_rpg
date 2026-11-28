import { describe, expect, it } from 'vitest';
import { sizeAtMost, withoutDependents } from '../../src/engine';
import { loadSrdCompendium } from '../../src/srd';

const srd = loadSrdCompendium();
const imposes = (monster: string, action: string) => {
  const found = srd.creatures.find((c) => c.id === monster)?.actions.find((a) => a.id === action);
  if (found?.kind !== 'attack' && found?.kind !== 'save') throw new Error(`${monster}/${action}`);
  return found.imposes;
};

describe('conditions imposed by monster actions (note 0065)', () => {
  it('plain conditions, with the size limit and the escape DC', () => {
    expect(imposes('wolf', 'bite')).toEqual([{ conditions: ['prone'], maxSize: 'medium' }]);
    expect(imposes('ankheg', 'bite')).toEqual([{ conditions: ['grappled'], maxSize: 'large', escapeDc: 13 }]);
    expect(imposes('balor', 'flame_whip')).toEqual([{ conditions: ['prone'], maxSize: 'huge' }]);
    expect(imposes('air_elemental', 'whirlwind')).toEqual([{ conditions: ['prone'] }]);
  });

  it('durations by the turn of the monster or of the target', () => {
    expect(imposes('wyvern', 'sting')).toEqual([{ conditions: ['poisoned'], end: 'actor_turn_start' }]);
    expect(imposes('cloud_giant', 'thundercloud')).toEqual([{ conditions: ['incapacitated'], end: 'target_turn_end' }]);
    expect(imposes('storm_giant', 'thunderbolt')).toEqual([{ conditions: ['blinded', 'deafened'], end: 'actor_turn_start' }]);
    // A segunda falha fica com o mestre.
    expect(imposes('young_brass_dragon', 'sleep_breath')).toEqual([{ conditions: ['incapacitated'], end: 'target_turn_end' }]);
  });

  it('conditions that last while another does', () => {
    expect(imposes('behir', 'constrict')).toEqual([{ conditions: ['grappled'], escapeDc: 16, while: ['restrained'] }]);
    expect(imposes('crocodile', 'bite')).toEqual([{ conditions: ['grappled'], maxSize: 'medium', escapeDc: 12, while: ['restrained'] }]);
    expect(imposes('roper', 'tentacle')).toEqual([{ conditions: ['grappled'], escapeDc: 14, while: ['poisoned'] }]);
    expect(imposes('chuul', 'paralyzing_tentacles')).toEqual([{ conditions: ['poisoned'], while: ['paralyzed'], repeatSave: true }]);
  });

  it('leaves to the GM what depends on something the table does not resolve', () => {
    for (const [monster, action] of [
      ['behir', 'swallow'],
      ['tarrasque', 'swallow'],
      ['boar', 'gore'],
      ['ghoul', 'claw'],
      ['cockatrice', 'petrifying_bite'],
      ['phase_spider', 'bite'],
      ['incubus', 'nightmare'],
      ['ghost', 'possession'],
      ['animated_rug_of_smothering', 'smother'],
      ['chain_devil', 'unnerving_gaze'],
    ] as const) {
      expect(imposes(monster, action), `${monster}/${action}`).toEqual([]);
    }
  });

  it('a Swallow lists what the swallowed creature has, not what it has when freed', () => {
    const fail = (id: string) => {
      const a = srd.creatures.find((c) => c.id === id)?.actions.find((x) => x.id === 'swallow');
      return a?.kind === 'save' ? a.onFailConditions : undefined;
    };
    expect(fail('behir')).toEqual(['blinded', 'restrained']);
    expect(fail('tarrasque')).toEqual(['blinded', 'restrained']);
    expect(fail('kraken')).toEqual(['restrained']);
  });

  it('sizes and dependent conditions', () => {
    expect(sizeAtMost('medium', 'large')).toBe(true);
    expect(sizeAtMost('huge', 'large')).toBe(false);
    expect(withoutDependents([{ condition: 'restrained' as const, with: 'grappled' as const }])).toEqual([]);
    expect(withoutDependents([{ condition: 'grappled' as const }, { condition: 'restrained' as const, with: 'grappled' as const }])).toHaveLength(2);
  });
});
