import {
  ABILITIES,
  type Ability,
  type AbilityScores,
  type Condition,
  type Sense,
  SKILL_ABILITY,
  SKILLS,
  type Skill,
} from '../schemas/common';
import type { Character, GmAdjustment } from '../schemas/character';
import type { BonusValue, Effect } from '../schemas/effect';
import type { Inventory } from '../schemas/inventory';
import type { Armor, Item, Weapon } from '../schemas/item';
import type { Predicate } from '../schemas/predicate';
import type { Compendium } from '../srd';
import { resolveBuild, type SourcedEffect } from './build';
import {
  abilityModifier,
  casterLevelContribution,
  EXHAUSTION_D20_PENALTY,
  EXHAUSTION_SPEED_PENALTY,
  fixedHitPointsPerLevel,
  MAX_EXHAUSTION,
  proficiencyBonus,
  spellSlots,
} from './math';
import type {
  AbilityStat,
  ClassSpellcasting,
  Contribution,
  DerivedSheet,
  GrantedSpell,
  Issue,
  ProficiencyLevel,
  RollState,
  RollStat,
  SaveStat,
  SkillStat,
  SourceLabel,
  Stat,
  WeaponAttack,
} from './types';

/**
 * Ficha derivada (docs/effects-spec.md, seção 4): escolhas + concessões +
 * efeitos de itens + ajustes do mestre. Nada aqui é editável: cada número é
 * recalculado a partir das entradas e guarda a própria conta.
 */

export interface SheetInput {
  character: Character;
  inventory: Inventory;
  adjustments: readonly GmAdjustment[];
  compendium: Compendium;
}

const ABILITY_NAME: Record<Ability, string> = { str: 'FOR', dex: 'DES', con: 'CON', int: 'INT', wis: 'SAB', cha: 'CAR' };
const RULE = (id: string, name: string): SourceLabel => ({ kind: 'rule', id, name });
const UNARMORED_BASE_AC = 10;
const ARMOR_TRAINING_RULE = RULE('armor_training', 'Treinamento com armadura');
const PASSIVE_BASE = 10;
const PASSIVE_ADVANTAGE = 5;
const DEFAULT_REACH = 5;
const REACH_BONUS = 5;
const HEAVY_WEAPON_MINIMUM = 13;
const HEAVY_ARMOR_SPEED_PENALTY = 10;
const SPELL_DC_BASE = 8;

/** Uma rolagem concreta: o que é atacado ou evitado. */
export interface RollContext {
  attack?: { kind: 'melee' | 'ranged' | 'spell'; properties: readonly string[] } | undefined;
  against?: { condition: Condition } | undefined;
}

/** Contexto para avaliar `when`. Sem `roll`, é a ficha estática. */
export interface PredicateContext {
  armor?: Armor | undefined;
  shield: boolean;
  roll?: RollContext | undefined;
}

/**
 * Avalia um predicado com lógica de três valores (docs/effects-spec.md, seção 2):
 * `undefined` = desconhecido, quando o predicado depende de uma rolagem e não há
 * rolagem no contexto.
 */
export function evaluatePredicate(p: Predicate, ctx: PredicateContext): boolean | undefined {
  if ('wearingArmor' in p) return p.wearingArmor === (ctx.armor !== undefined);
  if ('armorCategory' in p) return ctx.armor?.category === p.armorCategory;
  if ('wieldingShield' in p) return p.wieldingShield === ctx.shield;
  const { roll } = ctx;
  if ('attackKind' in p) return roll ? roll.attack?.kind === p.attackKind : undefined;
  if ('weaponProperty' in p) return roll ? (roll.attack?.properties.includes(p.weaponProperty) ?? false) : undefined;
  if ('against' in p) return roll ? roll.against?.condition === p.against.condition : undefined;
  const results = ('all' in p ? p.all : p.any).map((x) => evaluatePredicate(x, ctx));
  if ('all' in p) return results.includes(false) ? false : results.includes(undefined) ? undefined : true;
  return results.includes(true) ? true : results.includes(undefined) ? undefined : false;
}

/** Rótulo de uma parcela: o traço/opção, se houver, e a fonte ("Dwarven Toughness (Dwarf)"). */
const labelOf = (e: SourcedEffect): string => (e.detail && e.detail !== e.source.name ? `${e.detail} (${e.source.name})` : e.source.name);
const total = (parts: readonly Contribution[]): number => parts.reduce((sum, p) => sum + p.value, 0);
const stat = (parts: Contribution[]): Stat => ({ total: total(parts), parts });

export function deriveSheet(input: SheetInput): DerivedSheet {
  const { character, inventory, adjustments, compendium } = input;
  const build = resolveBuild(character, compendium);
  const issues: Issue[] = [...build.issues];
  const find = <T extends { id: string }>(list: readonly T[], id: string): T | undefined => list.find((x) => x.id === id);

  // --- Itens -------------------------------------------------------------

  const entries = inventory.items.flatMap((entry) => {
    const item = find(compendium.items, entry.itemId);
    if (!item) {
      issues.push({ severity: 'error', code: 'unknown_reference', message: `Item desconhecido no inventário: ${entry.itemId}.` });
      return [];
    }
    return [{ entry, item }];
  });
  const worn = entries.filter(({ entry, item }) => entry.equipped && item.kind === 'armor' && item.category !== 'shield');
  const shields = entries.filter(({ entry, item }) => entry.equipped && item.kind === 'armor' && item.category === 'shield');
  if (worn.length > 1) issues.push({ severity: 'error', code: 'multiple_armor', message: 'Só é possível vestir uma armadura por vez.' });
  if (shields.length > 1) issues.push({ severity: 'error', code: 'multiple_armor', message: 'Só é possível empunhar um escudo por vez.' });
  const armorItem = worn[0]?.item;
  const armor = armorItem?.kind === 'armor' ? armorItem : undefined;
  const ctx: PredicateContext = { armor, shield: shields.length > 0 };

  const isItemActive = (activation: Item['activation'], entry: { equipped: boolean; attuned: boolean }): boolean =>
    activation === 'carried' || (activation === 'equipped' && entry.equipped) || (activation === 'attuned' && entry.attuned);

  // Proficiências vêm só de escolhas e ajustes (itens não concedem treinamento com eles mesmos).
  const all: SourcedEffect[] = [
    ...build.effects,
    ...adjustments.flatMap((adj) => {
      const source: SourceLabel = { kind: 'adjustment', id: adj.id, name: adj.name };
      return adj.effects.map((effect): SourcedEffect => ({ effect, source, refKey: `adjustment:${adj.id}` }));
    }),
  ];
  const proficiencyEffects = all.filter((e) => e.effect.type === 'grant_proficiency');
  const has = (category: 'armor' | 'weapon', id: string): boolean =>
    proficiencyEffects.some(({ effect }) => effect.type === 'grant_proficiency' && effect.category === category && effect.id === id);

  const shieldTrained = has('armor', 'shield');
  if (shields.length && !shieldTrained) {
    issues.push({ severity: 'warning', code: 'shield_untrained', message: 'Sem treinamento com escudo: o escudo não dá bônus de CA.' });
  }
  for (const { entry, item } of entries) {
    if (!isItemActive(item.activation, entry)) continue;
    if (item.kind === 'armor' && item.category === 'shield' && !shieldTrained) continue;
    const source: SourceLabel = { kind: 'item', id: item.id, name: item.name };
    for (const effect of item.effects) all.push({ effect, source, refKey: `item:${entry.instanceId}` });
  }

  const armorTrained = armor === undefined || has('armor', armor.category);
  if (!armorTrained) {
    issues.push({
      severity: 'warning',
      code: 'armor_untrained',
      message: `Sem treinamento com armadura ${armor.category}: Desvantagem em testes d20 de FOR e DES e não pode conjurar magias.`,
    });
    const source = ARMOR_TRAINING_RULE;
    for (const target of ['save.str', 'save.dex', 'check.str', 'check.dex'] as const) {
      all.push({ effect: { type: 'disadvantage', target }, source, refKey: 'rule:armor_training' });
    }
  }

  /** Verdadeiro, falso ou desconhecido (depende de uma rolagem que não está no contexto). */
  const applies = (e: Effect, roll?: RollContext): boolean | undefined => (e.when ? evaluatePredicate(e.when, { ...ctx, roll }) : true);
  type Of<T extends Effect['type']> = SourcedEffect & { effect: Extract<Effect, { type: T }> };
  const ofType = <T extends Effect['type']>(type: T): Of<T>[] => all.filter((e): e is Of<T> => e.effect.type === type);
  /** Efeitos do tipo que valem com certeza no contexto. */
  const effectsOf = <T extends Effect['type']>(type: T, roll?: RollContext): Of<T>[] => ofType(type).filter((e) => applies(e.effect, roll) === true);

  // --- Atributos ----------------------------------------------------------

  const scoreParts = Object.fromEntries(ABILITIES.map((a) => [a, [...build.scores[a]]])) as Record<Ability, Contribution[]>;
  for (const { effect, source } of effectsOf('set_minimum_score')) {
    const current = total(scoreParts[effect.ability]);
    if (current < effect.value) scoreParts[effect.ability].push({ label: `Mínimo ${effect.value}`, value: effect.value - current, source });
  }
  const scores = Object.fromEntries(ABILITIES.map((a) => [a, total(scoreParts[a])])) as AbilityScores;
  const mod = (a: Ability): number => abilityModifier(scores[a]);
  const abilities = Object.fromEntries(
    ABILITIES.map((a) => [a, { ...stat(scoreParts[a]), modifier: mod(a) } satisfies AbilityStat]),
  ) as Record<Ability, AbilityStat>;

  const level = build.level;
  const pb = proficiencyBonus(level);

  // --- Condições -----------------------------------------------------------

  const conditions: DerivedSheet['conditions'] = [];
  let exhaustion = 0;
  for (const { effect, source } of effectsOf('condition')) {
    if (effect.condition === 'exhaustion') exhaustion += effect.level;
    else conditions.push({ condition: effect.condition, source });
  }
  exhaustion = Math.min(exhaustion, MAX_EXHAUSTION);
  if (conditions.length) {
    issues.push({
      severity: 'warning',
      code: 'not_supported',
      message: `Efeitos mecânicos de ${conditions.map((c) => c.condition).join(', ')} ainda não são aplicados na ficha (Fase 5).`,
    });
  }
  const exhaustionPart = (): Contribution[] =>
    exhaustion ? [{ label: `Exaustão ${exhaustion}`, value: -EXHAUSTION_D20_PENALTY * exhaustion, source: RULE('exhaustion', 'Exaustão') }] : [];

  // --- Bônus e rolagens -----------------------------------------------------

  const bonusValue = (value: BonusValue): number => {
    if (typeof value === 'number') return value;
    if ('ability' in value) return mod(value.ability);
    if ('proficiency' in value) return value.proficiency * pb;
    return value.perLevel * level;
  };
  const bonuses = (targets: readonly string[], roll?: RollContext): Contribution[] =>
    effectsOf('flat_bonus', roll)
      .filter(({ effect }) => targets.includes(effect.target))
      .map((e) => ({ label: e.effect.note ?? labelOf(e), value: bonusValue(e.effect.value), source: e.source }));

  const rollState = (targets: readonly string[], roll?: RollContext, extra: { kind: 'advantage' | 'disadvantage'; source: SourceLabel }[] = []): RollState => {
    const state: RollState = { mode: 'normal', advantage: [], disadvantage: [], situational: [] };
    for (const kind of ['advantage', 'disadvantage'] as const) {
      for (const { effect, source } of ofType(kind)) {
        if (!targets.includes(effect.target)) continue;
        const result = applies(effect, roll);
        if (result === false) continue;
        if (result === undefined || effect.note) state.situational.push({ kind, source, when: effect.when, note: effect.note });
        else state[kind].push(source);
      }
    }
    for (const e of extra) state[e.kind].push(e.source);
    const adv = state.advantage.length > 0;
    const dis = state.disadvantage.length > 0;
    state.mode = adv && !dis ? 'advantage' : dis && !adv ? 'disadvantage' : 'normal';
    return state;
  };

  const proficiencyLevel = (category: 'skill' | 'tool', id: string): ProficiencyLevel => {
    let result: ProficiencyLevel = 'none';
    for (const { effect } of effectsOf('grant_proficiency')) {
      if (effect.category !== category || effect.id !== id) continue;
      if ('level' in effect && effect.level === 'expertise') return 'expertise';
      result = 'proficient';
    }
    return result;
  };

  // --- Salvaguardas, perícias, iniciativa ------------------------------------

  const savesProficient = new Set(effectsOf('grant_proficiency').flatMap(({ effect }) => (effect.category === 'save' ? [effect.id] : [])));
  const saves = Object.fromEntries(
    ABILITIES.map((a) => {
      const proficient = savesProficient.has(a);
      const parts: Contribution[] = [
        { label: `Modificador de ${ABILITY_NAME[a]}`, value: mod(a) },
        ...(proficient ? [{ label: 'Proficiência', value: pb }] : []),
        ...bonuses([`save.${a}`, 'save.all']),
        ...exhaustionPart(),
      ];
      return [a, { ...stat(parts), proficient, roll: rollState([`save.${a}`, 'save.all']) } satisfies SaveStat];
    }),
  ) as Record<Ability, SaveStat>;

  const skills = Object.fromEntries(
    SKILLS.map((skill: Skill) => {
      const ability = SKILL_ABILITY[skill];
      const proficiency = proficiencyLevel('skill', skill);
      const multiplier = proficiency === 'expertise' ? 2 : proficiency === 'proficient' ? 1 : 0;
      const targets = [`skill.${skill}`, `check.${ability}`];
      const parts: Contribution[] = [
        { label: `Modificador de ${ABILITY_NAME[ability]}`, value: mod(ability) },
        ...(multiplier ? [{ label: multiplier === 2 ? 'Especialização' : 'Proficiência', value: pb * multiplier }] : []),
        ...bonuses(targets),
        ...exhaustionPart(),
      ];
      const roll = rollState(targets);
      const passiveParts: Contribution[] = [
        { label: 'Base', value: PASSIVE_BASE },
        { label: 'Modificador do teste', value: total(parts) },
        ...(roll.mode === 'advantage' ? [{ label: 'Vantagem', value: PASSIVE_ADVANTAGE }] : []),
        ...(roll.mode === 'disadvantage' ? [{ label: 'Desvantagem', value: -PASSIVE_ADVANTAGE }] : []),
        ...bonuses([`passive.${skill}`]),
      ];
      return [skill, { ...stat(parts), ability, proficiency, roll, passive: stat(passiveParts) } satisfies SkillStat];
    }),
  ) as Record<Skill, SkillStat>;

  const initiativeTargets = ['initiative', 'check.dex'];
  const initiative: RollStat = {
    ...stat([{ label: 'Modificador de DES', value: mod('dex') }, ...bonuses(initiativeTargets), ...exhaustionPart()]),
    roll: rollState(initiativeTargets),
  };

  // --- CA ---------------------------------------------------------------------

  const formulas = effectsOf('set_base_ac').map((e) => {
    const { effect, source } = e;
    const parts: Contribution[] = [{ label: labelOf(e), value: effect.base, source }];
    for (const a of effect.abilities) {
      const m = mod(a);
      const capped = a === 'dex' && effect.dexCap !== undefined ? Math.min(m, effect.dexCap) : m;
      parts.push({ label: `Modificador de ${ABILITY_NAME[a]}${capped !== m ? ` (máx. ${String(effect.dexCap)})` : ''}`, value: capped });
    }
    return parts;
  });
  const defaultFormula: Contribution[] = [
    { label: 'Sem armadura', value: UNARMORED_BASE_AC },
    { label: 'Modificador de DES', value: mod('dex') },
  ];
  const bestFormula = [defaultFormula, ...formulas].reduce((best, f) => (total(f) > total(best) ? f : best));
  const ac = stat([...bestFormula, ...bonuses(['ac'])]);

  // --- PV ---------------------------------------------------------------------

  const conMod = mod('con');
  const hpParts: Contribution[] = [];
  const hitDice = new Map<number, number>();
  const laterLevels = new Map<string, { name: string; perLevel: number; count: number }>();
  let conTotal = 0;
  build.levelOrder.forEach((classId, index) => {
    const cls = find(compendium.classes, classId);
    if (!cls) return;
    hitDice.set(cls.hitDie, (hitDice.get(cls.hitDie) ?? 0) + 1);
    // Nível 1 do personagem: dado máximo; depois, valor fixo. Cada nível ganha no mínimo 1 PV.
    const base = index === 0 ? cls.hitDie : fixedHitPointsPerLevel(cls.hitDie);
    conTotal += Math.max(1, base + conMod) - base;
    if (index === 0) {
      hpParts.push({ label: `Nível 1: ${cls.name} (dado máximo)`, value: base, source: { kind: 'class', id: cls.id, name: cls.name } });
    } else {
      const entry = laterLevels.get(cls.id) ?? { name: cls.name, perLevel: base, count: 0 };
      entry.count += 1;
      laterLevels.set(cls.id, entry);
    }
  });
  for (const [id, { name, perLevel, count }] of laterLevels) {
    hpParts.push({ label: `${name}: ${String(count)} nível(is) × ${String(perLevel)}`, value: perLevel * count, source: { kind: 'class', id, name } });
  }
  if (conTotal !== 0) hpParts.push({ label: `Modificador de CON × ${String(build.levelOrder.length)} nível(is)`, value: conTotal });
  const hpMax = stat([...hpParts, ...bonuses(['hp_max'])]);

  // --- Deslocamento -----------------------------------------------------------

  const species = build.speciesId ? find(compendium.species, build.speciesId) : undefined;
  const speedPenalties = (): Contribution[] => [
    ...(armor?.strength !== undefined && scores.str < armor.strength
      ? [{ label: `${armor.name} sem FOR ${armor.strength}`, value: -HEAVY_ARMOR_SPEED_PENALTY, source: { kind: 'item', id: armor.id, name: armor.name } as SourceLabel }]
      : []),
    ...(exhaustion ? [{ label: `Exaustão ${exhaustion}`, value: -EXHAUSTION_SPEED_PENALTY * exhaustion, source: RULE('exhaustion', 'Exaustão') }] : []),
  ];
  const speedStat = (kind: 'walk' | 'fly' | 'swim' | 'climb', base: Contribution[]): Stat => {
    const parts = [...base, ...bonuses([`speed.${kind}`])];
    if (total(parts) <= 0) return { total: 0, parts: [] };
    const result = stat([...parts, ...speedPenalties()]);
    return { ...result, total: Math.max(0, result.total) };
  };
  const speed = {
    walk: speedStat('walk', species ? [{ label: species.name, value: species.speed, source: { kind: 'species', id: species.id, name: species.name } }] : []),
    fly: speedStat('fly', []),
    swim: speedStat('swim', []),
    climb: speedStat('climb', []),
  };

  // --- Sentidos e defesas -----------------------------------------------------

  const senseMap = new Map<Sense, { sense: Sense; range: number; source: SourceLabel }>();
  for (const { effect, source } of effectsOf('grant_sense')) {
    const current = senseMap.get(effect.sense);
    if (!current || effect.range > current.range) senseMap.set(effect.sense, { sense: effect.sense, range: effect.range, source });
  }
  const groupBy = <K extends string>(list: { key: K; source: SourceLabel }[]): { key: K; sources: SourceLabel[] }[] => {
    const map = new Map<K, SourceLabel[]>();
    for (const { key, source } of list) map.set(key, [...(map.get(key) ?? []), source]);
    return [...map.entries()].map(([key, sources]) => ({ key, sources }));
  };
  const immunities = effectsOf('immunity');
  const defenses = {
    resistances: groupBy(effectsOf('resistance').map(({ effect, source }) => ({ key: effect.damageType, source }))).map(({ key, sources }) => ({ damageType: key, sources })),
    vulnerabilities: groupBy(effectsOf('vulnerability').map(({ effect, source }) => ({ key: effect.damageType, source }))).map(({ key, sources }) => ({ damageType: key, sources })),
    damageImmunities: groupBy(immunities.flatMap(({ effect, source }) => (effect.damageType ? [{ key: effect.damageType, source }] : []))).map(
      ({ key, sources }) => ({ damageType: key, sources }),
    ),
    conditionImmunities: groupBy(immunities.flatMap(({ effect, source }) => (effect.condition ? [{ key: effect.condition, source }] : []))).map(
      ({ key, sources }) => ({ condition: key, sources }),
    ),
  };

  // --- Proficiências ------------------------------------------------------------

  const uniqueIds = (category: string): string[] => [
    ...new Set(effectsOf('grant_proficiency').flatMap(({ effect }) => (effect.category === category ? [effect.id] : []))),
  ];
  const proficiencies = {
    armor: uniqueIds('armor'),
    weapons: uniqueIds('weapon'),
    tools: uniqueIds('tool').map((id) => ({ id, level: proficiencyLevel('tool', id) })),
    languages: uniqueIds('language'),
  };
  const weaponMasteries = [...new Set(effectsOf('weapon_mastery').map(({ effect }) => effect.weaponId))];

  // --- Ataques ------------------------------------------------------------------

  const attackFor = (weapon: Weapon, instanceId: string): WeaponAttack => {
    const finesse = weapon.properties.includes('finesse');
    const ability: Ability =
      weapon.attackKind === 'ranged' ? 'dex' : finesse && mod('dex') > mod('str') ? 'dex' : 'str';
    const proficient = has('weapon', weapon.category) || has('weapon', weapon.id);
    const attackCtx: RollContext = { attack: { kind: weapon.attackKind, properties: weapon.properties } };
    const extra: { kind: 'disadvantage'; source: SourceLabel }[] = [];
    const heavyAbility: Ability = weapon.attackKind === 'melee' ? 'str' : 'dex';
    if (weapon.properties.includes('heavy') && scores[heavyAbility] < HEAVY_WEAPON_MINIMUM) {
      extra.push({ kind: 'disadvantage', source: RULE('heavy', `Pesada sem ${ABILITY_NAME[heavyAbility]} ${HEAVY_WEAPON_MINIMUM}`) });
    }
    if (!armorTrained) extra.push({ kind: 'disadvantage', source: ARMOR_TRAINING_RULE });
    const attackParts: Contribution[] = [
      { label: `Modificador de ${ABILITY_NAME[ability]}`, value: mod(ability) },
      ...(proficient ? [{ label: 'Proficiência', value: pb }] : []),
      ...bonuses([`attack.${weapon.attackKind}`], attackCtx),
      ...exhaustionPart(),
    ];
    const damageParts: Contribution[] = [
      { label: `Modificador de ${ABILITY_NAME[ability]}`, value: mod(ability) },
      ...bonuses([`damage.${weapon.attackKind}`], attackCtx),
    ];
    return {
      itemId: weapon.id,
      instanceId,
      name: weapon.name,
      kind: weapon.attackKind,
      ability,
      proficient,
      attack: { ...stat(attackParts), roll: rollState([`attack.${weapon.attackKind}`, 'attack.all'], attackCtx, extra) },
      damage: { dice: weapon.damage.dice, bonus: stat(damageParts), type: weapon.damage.type },
      versatileDice: weapon.versatileDice,
      range: weapon.range,
      reach: weapon.attackKind === 'melee' ? DEFAULT_REACH + (weapon.properties.includes('reach') ? REACH_BONUS : 0) : 0,
      mastery: { property: weapon.mastery, available: weaponMasteries.includes(weapon.id) },
    };
  };
  const attacks = entries.flatMap(({ entry, item }) => (entry.equipped && item.kind === 'weapon' ? [attackFor(item, entry.instanceId)] : []));

  // --- Magias -------------------------------------------------------------------

  const spellDc = (ability: Ability): Stat =>
    stat([
      { label: 'Base', value: SPELL_DC_BASE },
      { label: `Modificador de ${ABILITY_NAME[ability]}`, value: mod(ability) },
      { label: 'Proficiência', value: pb },
      ...bonuses(['spell_save_dc']),
    ]);
  const spellAttack = (ability: Ability): Stat =>
    stat([
      { label: `Modificador de ${ABILITY_NAME[ability]}`, value: mod(ability) },
      { label: 'Proficiência', value: pb },
      ...bonuses(['attack.spell'], { attack: { kind: 'spell', properties: [] } }),
      ...exhaustionPart(),
    ]);

  let casterLevel = 0;
  const casterClasses: ClassSpellcasting[] = [];
  for (const { classId, level: classLevel } of build.classes) {
    const cls = find(compendium.classes, classId);
    if (!cls?.spellcasting) continue;
    const { ability, progression, preparedSpells } = cls.spellcasting;
    if (progression === 'pact') {
      issues.push({ severity: 'warning', code: 'not_supported', message: `Magia de Pacto (${cls.name}) ainda não é calculada.` });
    } else {
      casterLevel += casterLevelContribution(progression, classLevel);
    }
    const chosen = build.classSpells.get(classId) ?? { cantrips: [], spells: [] };
    casterClasses.push({
      classId,
      ability,
      saveDc: spellDc(ability),
      attack: spellAttack(ability),
      preparedSpells: preparedSpells[classLevel - 1] ?? 0,
      cantrips: chosen.cantrips,
      spells: chosen.spells,
    });
  }
  const granted: GrantedSpell[] = effectsOf('grant_spell').flatMap(({ effect, source, refKey }) => {
    const ability = typeof effect.ability === 'string' ? effect.ability : build.abilityChoices.get(refKey)?.get(effect.ability.choice);
    if (!ability) return []; // escolha de atributo pendente (já listada em `pending`)
    return [{ spellId: effect.spellId, ability, uses: effect.uses, saveDc: spellDc(ability).total, attackBonus: spellAttack(ability).total, source }];
  });

  const errors = issues.filter((i) => i.severity === 'error');
  return {
    complete: build.pending.length === 0 && errors.length === 0,
    pending: build.pending,
    issues,
    level,
    classes: build.classes,
    speciesId: build.speciesId,
    backgroundId: build.backgroundId,
    size: build.size,
    proficiencyBonus: pb,
    abilities,
    hpMax,
    hitDice: [...hitDice.entries()].map(([die, count]) => ({ die, count })),
    ac,
    initiative,
    speed,
    saves,
    skills,
    senses: [...senseMap.values()],
    defenses,
    proficiencies,
    weaponMasteries,
    attacks,
    spellcasting: { classes: casterClasses, slots: spellSlots(casterLevel), granted, canCast: armorTrained },
    feats: build.feats,
    features: build.features,
    conditions,
    exhaustion,
  };
}
