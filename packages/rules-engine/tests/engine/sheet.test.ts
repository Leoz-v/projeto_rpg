import { describe, expect, it } from 'vitest';
import type { CharacterInput } from '../../src/schemas/character';
import type { ItemInput } from '../../src/schemas/item';
import { compendiumWith, derive, errorsOf, fighterSteps, LANGUAGES, sel } from './helpers';

/** Regras do cálculo da ficha (docs/effects-spec.md e SRD 5.2.1). */

const wizardSteps: CharacterInput['steps'] = [
  { kind: 'species' as const, speciesId: 'dwarf', selections: [LANGUAGES] },
  { kind: 'background' as const, backgroundId: 'sage', abilityIncreases: { int: 2, con: 1 }, selections: [sel('feat', 'magic_initiate_wizard', 'spellcasting_ability', 'int'), sel('feat', 'magic_initiate_wizard', 'cantrips', 'minor_illusion', 'prestidigitation'), sel('feat', 'magic_initiate_wizard', 'level_1_spell', 'shield')] },
  {
    kind: 'class_level' as const,
    classId: 'wizard',
    selections: [sel('class', 'wizard', 'skills', 'insight', 'medicine'), sel('class', 'wizard', 'cantrips', 'fire_bolt', 'light', 'mage_hand'), sel('class', 'wizard', 'spellbook_1', 'detect_magic', 'feather_fall', 'mage_armor', 'magic_missile', 'sleep', 'thunderwave')],
  },
];

describe('armor class', () => {
  it('uses 10 + DEX without armor', () => {
    expect(derive({}).ac.total).toBe(11);
  });

  it('caps DEX for medium armor', () => {
    const dexterous = { method: 'manual' as const, scores: { str: 10, dex: 18, con: 14, int: 8, wis: 12, cha: 10 } };
    const sheet = derive({ baseScores: dexterous, inventory: { items: [{ instanceId: 'a', itemId: 'breastplate', equipped: true }] } });
    // 14 + DES (+4, máx. 2) + Defesa 1.
    expect(sheet.ac.total).toBe(17);
  });

  it('does not stack base formulas: the highest wins, flat bonuses add on top', () => {
    const unarmored = { id: 'unarmored', name: 'Defesa sem armadura (teste)', effects: [{ type: 'set_base_ac', base: 10, abilities: ['dex', 'con'] }] };
    const ring = { id: 'ring', name: 'Anel +1', effects: [{ type: 'flat_bonus', target: 'ac', value: 1 }] };
    // Sem armadura: a fórmula de teste (10 + DES 1 + CON 2) vence a padrão (10 + DES 1); o Anel soma por cima.
    const sheet = derive({ adjustments: [unarmored, ring] });
    expect(sheet.ac.total).toBe(10 + 1 + 2 + 1);
    const armored = derive({ adjustments: [unarmored, ring], inventory: { items: [{ instanceId: 'a', itemId: 'chain_mail', equipped: true }] } });
    // Cota de malha 16 é maior que 13: 16 + Defesa 1 + Anel 1.
    expect(armored.ac.total).toBe(18);
  });

  it('ignores the shield without training and warns', () => {
    const steps = [
      { kind: 'species' as const, speciesId: 'dwarf', selections: [LANGUAGES] },
      ...wizardSteps.slice(1),
    ];
    const sheet = derive({ steps, inventory: { items: [{ instanceId: 's', itemId: 'shield', equipped: true }] } });
    expect(sheet.ac.total).toBe(10 + 1);
    expect(sheet.issues.map((i) => i.code)).toContain('shield_untrained');
  });

  it('only counts equipped armor', () => {
    expect(derive({ inventory: { items: [{ instanceId: 'a', itemId: 'plate_armor' }] } }).ac.total).toBe(11);
  });

  it('rejects two suits of armor', () => {
    const items = [
      { instanceId: 'a', itemId: 'chain_mail', equipped: true },
      { instanceId: 'b', itemId: 'plate_armor', equipped: true },
    ];
    expect(errorsOf(derive({ inventory: { items } }))).toEqual(['multiple_armor']);
  });
});

describe('armor training', () => {
  it('gives disadvantage on STR/DEX d20 tests and blocks spellcasting', () => {
    const sheet = derive({ steps: wizardSteps, inventory: { items: [{ instanceId: 'a', itemId: 'chain_mail', equipped: true }] } });
    expect(sheet.issues.map((i) => i.code)).toContain('armor_untrained');
    expect(sheet.saves.dex.roll.mode).toBe('disadvantage');
    expect(sheet.skills.athletics.roll.mode).toBe('disadvantage');
    expect(sheet.saves.int.roll.mode).toBe('normal');
    expect(sheet.spellcasting.canCast).toBe(false);
  });

  it('reduces speed by 10 ft when STR is below the armor requirement', () => {
    const weak = { method: 'manual' as const, scores: { str: 10, dex: 13, con: 14, int: 8, wis: 12, cha: 10 } };
    // FOR 10 + 2 = 12 < 13 (Cota de malha).
    expect(derive({ baseScores: weak, inventory: { items: [{ instanceId: 'a', itemId: 'chain_mail', equipped: true }] } }).speed.walk.total).toBe(20);
    expect(derive({ inventory: { items: [{ instanceId: 'a', itemId: 'chain_mail', equipped: true }] } }).speed.walk.total).toBe(30);
  });
});

describe('advantage and disadvantage', () => {
  it('cancel each other regardless of how many sources (2024)', () => {
    const adj = { id: 'x', name: 'Ajuste', effects: [{ type: 'advantage', target: 'skill.stealth' }, { type: 'advantage', target: 'check.dex' }] };
    const sheet = derive({ adjustments: [adj], inventory: { items: [{ instanceId: 'a', itemId: 'chain_mail', equipped: true }] } });
    expect(sheet.skills.stealth.roll.advantage).toHaveLength(2);
    expect(sheet.skills.stealth.roll.disadvantage).toHaveLength(1);
    expect(sheet.skills.stealth.roll.mode).toBe('normal');
  });

  it('keeps roll-dependent effects as structured reminders without applying them', () => {
    const sheet = derive({});
    expect(sheet.saves.con.roll.mode).toBe('normal');
    expect(sheet.saves.con.roll.situational).toEqual([
      { kind: 'advantage', source: { kind: 'species', id: 'dwarf', name: 'Dwarven Resilience (Dwarf)' }, when: { against: { condition: 'poisoned' } }, note: undefined },
    ]);
  });

  it('keeps effects with a free-text note as reminders', () => {
    const adj = { id: 'x', name: 'Ajuste', effects: [{ type: 'advantage', target: 'save.wis', note: 'Contra ilusões' }] };
    const roll = derive({ adjustments: [adj] }).saves.wis.roll;
    expect(roll.mode).toBe('normal');
    expect(roll.situational.filter((s) => s.source.kind === 'adjustment').map((s) => s.note)).toEqual(['Contra ilusões']);
  });

  it('drops roll-dependent effects that are certainly false', () => {
    // all: [sem armadura, contra Envenenado] vestindo armadura é falso, não desconhecido.
    const adj = { id: 'x', name: 'Ajuste', effects: [{ type: 'advantage', target: 'save.con', when: { all: [{ wearingArmor: false }, { against: { condition: 'poisoned' } }] } }] };
    const armored = derive({ adjustments: [adj], inventory: { items: [{ instanceId: 'a', itemId: 'chain_mail', equipped: true }] } });
    expect(armored.saves.con.roll.situational.map((s) => s.source.kind)).toEqual(['species']);
    expect(derive({ adjustments: [adj] }).saves.con.roll.situational.map((s) => s.source.kind)).toEqual(['species', 'adjustment']);
  });

  it('does not add roll-dependent flat bonuses to static totals', () => {
    const adj = { id: 'x', name: 'Ajuste', effects: [{ type: 'flat_bonus', target: 'save.con', value: 2, when: { against: { condition: 'poisoned' } } }] };
    expect(derive({ adjustments: [adj] }).saves.con.total).toBe(derive({}).saves.con.total);
  });

  it('models Powerful Build as advantage on checks to end Grappled', () => {
    const steps = fighterSteps();
    steps[0] = { kind: 'species', speciesId: 'goliath', selections: [LANGUAGES, sel('species', 'goliath', 'giant_ancestry', 'stones_endurance')] };
    const athletics = derive({ steps }).skills.athletics.roll;
    expect(athletics.mode).toBe('normal');
    expect(athletics.situational.map((s) => s.when)).toEqual([{ against: { condition: 'grappled' } }]);
  });

  it('adds +5 / -5 to passive scores', () => {
    const adj = { id: 'x', name: 'Ajuste', effects: [{ type: 'advantage', target: 'skill.perception' }] };
    // Percepção: SAB +1, proficiente +2 = +3 → passiva 13; com vantagem 18.
    expect(derive({}).skills.perception.passive.total).toBe(13);
    expect(derive({ adjustments: [adj] }).skills.perception.passive.total).toBe(18);
  });
});

describe('exhaustion', () => {
  it('applies -2 per level to d20 tests and -5 ft speed, summing sources up to 6', () => {
    const one = { id: 'a', name: 'Maldição', effects: [{ type: 'condition', condition: 'exhaustion', level: 2 }] };
    const two = { id: 'b', name: 'Fome', effects: [{ type: 'condition', condition: 'exhaustion', level: 1 }] };
    const sheet = derive({ adjustments: [one, two] });
    expect(sheet.exhaustion).toBe(3);
    expect(sheet.saves.str.total).toBe(derive({}).saves.str.total - 6);
    expect(sheet.skills.athletics.total).toBe(derive({}).skills.athletics.total - 6);
    expect(sheet.speed.walk.total).toBe(15);
    const many = { id: 'c', name: 'Muito', effects: [{ type: 'condition', condition: 'exhaustion', level: 5 }] };
    expect(derive({ adjustments: [one, many] }).exhaustion).toBe(6);
  });

  it('warns that other conditions are not applied yet', () => {
    const sheet = derive({ adjustments: [{ id: 'p', name: 'Veneno', effects: [{ type: 'condition', condition: 'poisoned' }] }] });
    expect(sheet.conditions.map((c) => c.condition)).toEqual(['poisoned']);
    expect(sheet.issues.map((i) => i.code)).toContain('not_supported');
  });
});

describe('items', () => {
  const gauntlets: ItemInput = { id: 'gauntlets_of_ogre_power', name: 'Gauntlets of Ogre Power', kind: 'gear', activation: 'attuned', effects: [{ type: 'set_minimum_score', ability: 'str', value: 19 }] };
  const cloak: ItemInput = { id: 'cloak_of_protection', name: 'Cloak of Protection', kind: 'gear', activation: 'attuned', effects: [{ type: 'flat_bonus', target: 'ac', value: 1 }, { type: 'flat_bonus', target: 'save.all', value: 1 }] };
  const compendium = compendiumWith([gauntlets, cloak]);

  it('applies attunement items only while attuned', () => {
    expect(derive({ compendium, inventory: { items: [{ instanceId: 'c', itemId: 'cloak_of_protection', equipped: true }] } }).ac.total).toBe(11);
    const attuned = derive({ compendium, inventory: { items: [{ instanceId: 'c', itemId: 'cloak_of_protection', equipped: true, attuned: true }] } });
    expect(attuned.ac.total).toBe(12);
    expect(attuned.saves.wis.total).toBe(derive({}).saves.wis.total + 1);
    expect(attuned.ac.parts.at(-1)).toMatchObject({ label: 'Cloak of Protection', value: 1, source: { kind: 'item', id: 'cloak_of_protection' } });
  });

  it('raises a score to the minimum without lowering higher scores', () => {
    const items = [{ instanceId: 'g', itemId: 'gauntlets_of_ogre_power', attuned: true }];
    expect(derive({ compendium, inventory: { items } }).abilities.str.total).toBe(19);
    // FOR 18 + 2 (Soldado) = 20, acima do mínimo 19: a manopla não muda nada.
    const titan = { method: 'manual' as const, scores: { str: 18, dex: 13, con: 14, int: 8, wis: 12, cha: 10 } };
    const sheet = derive({ compendium, baseScores: titan, inventory: { items } });
    expect(sheet.abilities.str.total).toBe(20);
    expect(sheet.abilities.str.parts.map((p) => p.label)).not.toContain('Mínimo 19');
  });

  it('reports unknown items', () => {
    expect(errorsOf(derive({ inventory: { items: [{ instanceId: 'x', itemId: 'vorpal_spoon' }] } }))).toEqual(['unknown_reference']);
  });
});

describe('weapon attacks', () => {
  it('uses the higher of STR and DEX for finesse weapons', () => {
    const nimble = { method: 'manual' as const, scores: { str: 8, dex: 16, con: 14, int: 8, wis: 12, cha: 10 } };
    const sheet = derive({ baseScores: nimble, inventory: { items: [{ instanceId: 'r', itemId: 'rapier', equipped: true }] } });
    // DES 16 (+3) > FOR 10 (+0): +3 + PB 2.
    expect(sheet.attacks[0]).toMatchObject({ ability: 'dex', attack: { total: 5 }, damage: { bonus: { total: 3 } } });
  });

  it('gives disadvantage with Heavy weapons below 13 in the ability', () => {
    const weak = { method: 'manual' as const, scores: { str: 8, dex: 13, con: 14, int: 8, wis: 12, cha: 10 } };
    const sheet = derive({ baseScores: weak, inventory: { items: [{ instanceId: 'g', itemId: 'greatsword', equipped: true }] } });
    expect(sheet.attacks[0]?.attack.roll.mode).toBe('disadvantage');
  });

  it('applies attack bonuses only to matching attack kinds (Archery)', () => {
    const steps = fighterSteps();
    steps[2] = {
      kind: 'class_level',
      classId: 'fighter',
      selections: [sel('class', 'fighter', 'skills', 'perception', 'survival'), sel('class', 'fighter', 'fighting_style', 'archery'), sel('class', 'fighter', 'weapon_mastery_1', 'longbow', 'greatsword', 'handaxe')],
    };
    const sheet = derive({ steps, inventory: { items: [{ instanceId: 'b', itemId: 'longbow', equipped: true }, { instanceId: 's', itemId: 'longsword', equipped: true }] } });
    const [bow, sword] = sheet.attacks;
    // Arco: DES 1 + PB 2 + Arquearia 2. Espada: FOR 3 + PB 2.
    expect(bow?.attack.total).toBe(5);
    expect(sword?.attack.total).toBe(5);
    expect(bow?.mastery).toEqual({ property: 'slow', available: true });
    expect(sword?.mastery).toEqual({ property: 'sap', available: false });
  });
});

describe('hit points', () => {
  it('gains at least 1 HP per level with a negative CON modifier', () => {
    const frail = { method: 'manual' as const, scores: { str: 15, dex: 13, con: 3, int: 8, wis: 12, cha: 10 } };
    // CON 3 + 1 = 4 → −3. Nível 1: max(1, 10 − 3) = 7; nível 2: max(1, 6 − 3) = 3; Anão +2.
    const sheet = derive({ baseScores: frail, steps: fighterSteps([{ kind: 'class_level', classId: 'fighter' }]) });
    expect(sheet.hpMax.total).toBe(7 + 3 + 2);
    const awful = { method: 'manual' as const, scores: { str: 15, dex: 13, con: 1, int: 8, wis: 12, cha: 10 } };
    // CON 1 + 1 = 2 → −4. Nível 1: max(1, 10 − 4) = 6; nível 2: max(1, 6 − 4) = 2; Anão +2.
    const fragile = derive({ baseScores: awful, steps: fighterSteps([{ kind: 'class_level', classId: 'fighter' }]) });
    expect(fragile.hpMax.total).toBe(6 + 2 + 2);
  });

  it('recomputes all levels when CON changes (derived, never stored)', () => {
    const base = derive({ steps: fighterSteps([{ kind: 'class_level', classId: 'fighter' }]) });
    const tougher = derive({ steps: fighterSteps([{ kind: 'class_level', classId: 'fighter' }]), adjustments: [{ id: 'b', name: 'Bênção', effects: [{ type: 'set_minimum_score', ability: 'con', value: 18 }] }] });
    // CON 15 (+2) → 18 (+4): +2 por nível em 2 níveis.
    expect(tougher.hpMax.total).toBe(base.hpMax.total + 4);
  });
});

describe('GM adjustments', () => {
  it('layer effects on top with their own source', () => {
    const blessing = { id: 'blessing', name: 'Bênção do Templo', effects: [{ type: 'resistance', damageType: 'necrotic' }, { type: 'resistance', damageType: 'poison' }] };
    const sheet = derive({ adjustments: [blessing] });
    const poison = sheet.defenses.resistances.find((r) => r.damageType === 'poison');
    // Anão + bênção: uma resistência, duas fontes.
    expect(poison?.sources.map((s) => s.kind)).toEqual(['species', 'adjustment']);
    expect(sheet.defenses.resistances.map((r) => r.damageType)).toEqual(['poison', 'necrotic']);
  });
});

describe('spellcasting', () => {
  it('resolves the spellcasting ability chosen for granted spells', () => {
    const steps = wizardSteps.map((s) =>
      s.kind === 'background'
        ? { ...s, selections: [sel('feat', 'magic_initiate_wizard', 'spellcasting_ability', 'wis'), sel('feat', 'magic_initiate_wizard', 'cantrips', 'minor_illusion', 'prestidigitation'), sel('feat', 'magic_initiate_wizard', 'level_1_spell', 'shield')] }
        : s,
    );
    const smart = { method: 'standard_array' as const, scores: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 } };
    const sheet = derive({ steps, baseScores: smart });
    // SAB 12 (+1): CD 8 + 1 + 2 = 11. INT 17 (+3) do Mago: CD 13.
    expect(sheet.spellcasting.granted.map((g) => [g.spellId, g.ability, g.saveDc])).toEqual([
      ['minor_illusion', 'wis', 11],
      ['prestidigitation', 'wis', 11],
      ['shield', 'wis', 11],
    ]);
    expect(sheet.spellcasting.classes[0]?.saveDc.total).toBe(13);
  });

  it('omits granted spells whose ability choice is still pending', () => {
    const steps = wizardSteps.map((s) =>
      s.kind === 'background' ? { ...s, selections: [sel('feat', 'magic_initiate_wizard', 'cantrips', 'minor_illusion', 'prestidigitation'), sel('feat', 'magic_initiate_wizard', 'level_1_spell', 'shield')] } : s,
    );
    const sheet = derive({ steps });
    expect(sheet.spellcasting.granted).toEqual([]);
    expect(sheet.pending.map((p) => p.choiceId)).toEqual(['spellcasting_ability']);
  });
});
