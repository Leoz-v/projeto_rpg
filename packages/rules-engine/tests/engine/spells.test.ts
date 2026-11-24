import { describe, expect, it } from 'vitest';
import { addDice, addFlat, cantripTier, multiplyDice, resolveSpellParts, spellDamageWith } from '../../src/engine/spells';
import { loadSrdCompendium } from '../../src/srd';
import type { ResolvedSpellPart } from '../../src/engine/spells';

const damageOf = (part: ResolvedSpellPart | undefined) => (part && 'damage' in part ? part.damage : []);

/** Resolução das magias de dano (nota 0054). */
const srd = loadSrdCompendium();
const spell = (id: string) => {
  const found = srd.spells.find((s) => s.id === id);
  if (!found) throw new Error(`magia ${id} não está no compêndio`);
  return found;
};

describe('dice expressions', () => {
  it('adds dice of the same size together and keeps the flat part', () => {
    expect(addDice('8d6', '1d6', 2)).toBe('10d6');
    expect(addDice('10d6+40', '3d6', 1)).toBe('13d6+40');
    expect(addDice('1d4+1', '1d6', 1)).toBe('1d4+1d6+1');
    expect(addDice('8d6', '1d6', 0)).toBe('8d6');
  });

  it('multiplies only the dice', () => {
    expect(multiplyDice('1d10', 3)).toBe('3d10');
    expect(multiplyDice('1d4+1', 2)).toBe('2d4+1');
  });

  it('adds a positive or negative modifier', () => {
    expect(addFlat('1d8', 3)).toBe('1d8+3');
    expect(addFlat('1d8', -1)).toBe('1d8-1');
    expect(addFlat('1d8', 0)).toBe('1d8');
    expect(addFlat('2d6+1', -1)).toBe('2d6');
  });
});

describe('cantrip tiers (SRD: levels 5, 11 and 17)', () => {
  it.each([
    [1, 1],
    [4, 1],
    [5, 2],
    [10, 2],
    [11, 3],
    [16, 3],
    [17, 4],
    [20, 4],
  ])('character level %i is tier %i', (level, tier) => {
    expect(cantripTier(level)).toBe(tier);
  });
});

describe('resolveSpellParts', () => {
  it('Fireball: 8d6 Fire, Dexterity save for half, +1d6 per slot above 3', () => {
    const at3 = resolveSpellParts(spell('fireball'), { characterLevel: 5, modifier: 4 });
    // Salvaguarda sem `count`: quantos alvos a mesa marcar.
    expect(at3).toEqual([{ kind: 'save', ability: 'dex', onSuccess: 'half', onFailConditions: [], damage: [{ dice: '8d6', type: 'fire' }] }]);
    expect(damageOf(resolveSpellParts(spell('fireball'), { slotLevel: 5, characterLevel: 9, modifier: 4 })[0])).toEqual([{ dice: '10d6', type: 'fire' }]);
  });

  it('a slot below the spell level does not shrink the damage', () => {
    expect(damageOf(resolveSpellParts(spell('fireball'), { slotLevel: 1, characterLevel: 5, modifier: 4 })[0])[0]?.dice).toBe('8d6');
  });

  it('Fire Bolt grows with the character level, not the slot', () => {
    const at = (characterLevel: number) => resolveSpellParts(spell('fire_bolt'), { slotLevel: 9, characterLevel, modifier: 5 })[0];
    expect(at(1)).toMatchObject({ kind: 'attack', attackKind: 'ranged', count: 1, damage: [{ dice: '1d10', type: 'fire' }] });
    expect(damageOf(at(5))[0]?.dice).toBe('2d10');
    expect(damageOf(at(11))[0]?.dice).toBe('3d10');
    expect(damageOf(at(17))[0]?.dice).toBe('4d10');
  });

  it('Eldritch Blast creates more beams instead of more dice', () => {
    const at = (characterLevel: number) => resolveSpellParts(spell('eldritch_blast'), { characterLevel, modifier: 3 })[0];
    expect(at(4)).toMatchObject({ count: 1, damage: [{ dice: '1d10', type: 'force' }] });
    expect(at(5)).toMatchObject({ count: 2, damage: [{ dice: '1d10' }] });
    expect(at(17)?.count).toBe(4);
  });

  it('Scorching Ray and Magic Missile add projectiles per slot level', () => {
    expect(resolveSpellParts(spell('scorching_ray'), { slotLevel: 4, characterLevel: 7, modifier: 4 })[0]).toMatchObject({
      count: 5,
      damage: [{ dice: '2d6', type: 'fire' }],
    });
    expect(resolveSpellParts(spell('magic_missile'), { slotLevel: 3, characterLevel: 5, modifier: 4 })[0]).toMatchObject({
      kind: 'damage',
      count: 5,
      damage: [{ dice: '1d4+1', type: 'force' }],
    });
  });

  it('Spiritual Weapon adds the spellcasting modifier and scales per slot', () => {
    expect(damageOf(resolveSpellParts(spell('spiritual_weapon'), { slotLevel: 4, characterLevel: 7, modifier: 4 })[0])).toEqual([
      { dice: '3d8+4', type: 'force' },
    ]);
  });

  it('Ice Storm scales only the Bludgeoning part', () => {
    expect(damageOf(resolveSpellParts(spell('ice_storm'), { slotLevel: 6, characterLevel: 11, modifier: 4 })[0])).toEqual([
      { dice: '4d10', type: 'bludgeoning' },
      { dice: '4d6', type: 'cold' },
    ]);
  });

  it('Ice Knife has two named parts: the shard attack and the save against the burst', () => {
    const parts = resolveSpellParts(spell('ice_knife'), { slotLevel: 2, characterLevel: 3, modifier: 3 });
    expect(parts.map((p) => [p.label, p.kind])).toEqual([
      ['Fragmento', 'attack'],
      ['Explosão', 'save'],
    ]);
    expect(parts[1]).toMatchObject({ ability: 'dex', onSuccess: 'none', damage: [{ dice: '3d6', type: 'cold' }] });
  });

  it('Chromatic Orb leaves the damage type for the caster to choose', () => {
    expect(damageOf(resolveSpellParts(spell('chromatic_orb'), { characterLevel: 1, modifier: 3 })[0])[0]?.type).toEqual([
      'acid',
      'cold',
      'fire',
      'lightning',
      'poison',
      'thunder',
    ]);
  });

  it('Acid Arrow deals half damage on a miss and has the delayed damage as a separate part', () => {
    const parts = resolveSpellParts(spell('acid_arrow'), { slotLevel: 3, characterLevel: 5, modifier: 4 });
    expect(parts[0]).toMatchObject({ kind: 'attack', onMiss: 'half', damage: [{ dice: '5d4', type: 'acid' }] });
    expect(parts[1]).toMatchObject({ kind: 'damage', label: 'Fim do próximo turno do alvo', damage: [{ dice: '3d4', type: 'acid' }] });
  });

  it('keeps the conditions of a failed save or a hit', () => {
    expect(resolveSpellParts(spell('sunburst'), { characterLevel: 15, modifier: 5 })[0]).toMatchObject({ onFailConditions: ['blinded'] });
    expect(resolveSpellParts(spell('ray_of_sickness'), { characterLevel: 1, modifier: 3 })[0]).toMatchObject({ onHitConditions: ['poisoned'] });
  });

  it('healing scales per slot and adds the modifier; Heal scales a flat amount', () => {
    expect(resolveSpellParts(spell('cure_wounds'), { slotLevel: 3, characterLevel: 5, modifier: 3 })).toEqual([{ kind: 'heal', healing: '6d8+3', endConditions: [] }]);
    expect(resolveSpellParts(spell('heal'), { slotLevel: 8, characterLevel: 15, modifier: 5 })[0]).toMatchObject({
      healing: '90',
      endConditions: ['blinded', 'deafened', 'poisoned'],
    });
    expect(resolveSpellParts(spell('false_life'), { slotLevel: 2, characterLevel: 3, modifier: 3 })[0]).toMatchObject({ healing: '2d4+9', temporary: true });
    expect(resolveSpellParts(spell('power_word_heal'), { characterLevel: 17, modifier: 5 })[0]).toMatchObject({ healing: 'full' });
    expect(resolveSpellParts(spell('mass_cure_wounds'), { characterLevel: 9, modifier: 4 })[0]).toMatchObject({ healing: '5d8+4', count: 6 });
  });

  it('condition saves: no damage, the targets per slot and how long the condition lasts', () => {
    expect(resolveSpellParts(spell('hold_person'), { slotLevel: 4, characterLevel: 7, modifier: 4 })).toEqual([
      { kind: 'save', ability: 'wis', onSuccess: 'none', onFailConditions: ['paralyzed'], conditionsEnd: 'spell', damage: [], count: 3 },
    ]);
    expect(resolveSpellParts(spell('blindness_deafness'), { characterLevel: 3, modifier: 3 })[0]).toMatchObject({ conditionChoice: true, onFailConditions: ['blinded', 'deafened'] });
    expect(resolveSpellParts(spell('color_spray'), { characterLevel: 1, modifier: 3 })[0]).toMatchObject({ conditionsEnd: 'caster_turn_end' });
    expect(resolveSpellParts(spell('grease'), { characterLevel: 1, modifier: 3 })[0]).not.toHaveProperty('conditionsEnd');
    expect(resolveSpellParts(spell('invisibility'), { slotLevel: 3, characterLevel: 5, modifier: 3 })).toEqual([
      { kind: 'condition', conditions: ['invisible'], conditionsEnd: 'spell', count: 2 },
    ]);
  });

  it('a text-only spell has no parts', () => {
    expect(resolveSpellParts(spell('light'), { characterLevel: 1, modifier: 3 })).toEqual([]);
  });
});

describe('spellDamageWith', () => {
  it('keeps fixed types and requires a choice from the list', () => {
    const orb = damageOf(resolveSpellParts(spell('chromatic_orb'), { characterLevel: 1, modifier: 3 })[0]);
    expect(spellDamageWith(orb, 'fire')).toEqual([{ dice: '3d8', type: 'fire' }]);
    expect(spellDamageWith(orb, undefined)).toBeUndefined();
    expect(spellDamageWith(orb, 'radiant')).toBeUndefined();
    expect(spellDamageWith([{ dice: '8d6', type: 'fire' }], 'cold')).toEqual([{ dice: '8d6', type: 'fire' }]);
  });
});

describe('spells with structured resolution in the SRD compendium', () => {
  const structured = srd.spells.filter((s) => s.resolution.length > 0);

  it('covers the damage, healing and condition spells (125 of 339)', () => {
    expect(structured).toHaveLength(125);
  });

  it('every damaging cantrip upgrades with the character level', () => {
    const cantrips = structured.filter((s) => s.level === 0 && s.resolution.some((p) => 'damage' in p && p.damage.length > 0));
    expect(cantrips.length).toBeGreaterThan(10);
    expect(cantrips.filter((s) => !s.cantripUpgrade).map((s) => s.id)).toEqual([]);
  });
});
