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
import { type Inventory, type InventoryEntry, MAX_ATTUNED_ITEMS } from '../schemas/inventory';
import type { Armor, Item, Weapon } from '../schemas/item';
import type { Predicate } from '../schemas/predicate';
import type { Compendium } from '../srd';
import { resolveBuild, type SourcedEffect } from './build';
import { type ConditionRoll, conditionDefenses, conditionSource, effectiveConditions, ownRollConditions, SPEED_ZERO_CONDITIONS } from './conditions';
import { availableCharges, type ChargedItem, chargedItem, itemSpellCosts, itemSpellLevel } from './item-charges';
import { scrollOf, scrollReading } from './scrolls';
import type { AttackRider } from './attack-riders';
import { addDice } from './spells';
import { resolveFeatureUses } from './feature-uses';
import { resolveSelfInspirations } from './inspiration';
import { itemUse, itemUseOptions } from './item-use';
import { type MagicPart, resolveInventory } from './items';
import { isWeaponProficient } from './proficiency';
import { deriveVisionProfile } from './vision';
import {
  abilityModifier,
  casterLevelContribution,
  EXHAUSTION_D20_PENALTY,
  EXHAUSTION_SPEED_PENALTY,
  fixedHitPointsPerLevel,
  pactMagicSlots,
  MAX_EXHAUSTION,
  proficiencyBonus,
  spellSlots,
} from './math';
import type {
  AbilityStat,
  ClassSpellcasting,
  Contribution,
  DerivedSheet,
  CastableSpell,
  SheetResource,
  SheetTrigger,
  GrantedSpell,
  InventoryLine,
  Issue,
  ProficiencyLevel,
  RollStat,
  RollState,
  SaveStat,
  SkillStat,
  SourcedD20Rule,
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
  /** Condições postas na mesa (não vêm de itens nem de ajustes) e o nível de Exaustão. */
  conditions?: TableConditions | undefined;
}

/** Condições ativas de uma criatura na mesa, como o estado da sessão guarda (Exaustão à parte, 0 a 6). */
export interface TableConditions {
  active: readonly { condition: Exclude<Condition, 'exhaustion'> }[];
  exhaustion: number;
}

/** Fonte das condições postas na mesa. */
export const TABLE_CONDITION_SOURCE: SourceLabel = { kind: 'rule', id: 'table_conditions', name: 'Condição na mesa' };

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
/** Acerto Crítico padrão: 20 natural. */
const CRITICAL_HIT = 20;

/** Uma rolagem concreta: o que é atacado ou evitado. */
export interface RollContext {
  attack?:
    | {
        kind: 'melee' | 'ranged' | 'spell';
        properties: readonly string[];
        category?: 'simple' | 'martial' | undefined;
        weaponId?: string | undefined;
        /** Empunhada com as duas mãos (Two-Handed, ou Versatile com as duas mãos). */
        twoHanded?: boolean | undefined;
      }
    | undefined;
  /**
   * O que a rolagem evita: uma condição e/ou a origem (`spell` = magia; `magic` = outro
   * efeito mágico). Contra uma magia, use `spell`: ela satisfaz também `against.source: magic`.
   */
  against?: { condition?: Condition | undefined; source?: 'spell' | 'magic' | undefined; concentration?: boolean | undefined } | undefined;
}

/** Contexto para avaliar `when`. Sem `roll`, é a ficha estática. */
export interface PredicateContext {
  armor?: Armor | undefined;
  shield: boolean;
  /** Condições atuais da criatura (para `hasCondition`). */
  conditions: ReadonlySet<Condition>;
  /** Espécie do personagem (para `species`); ausente em criaturas sem espécie. */
  speciesId?: string | undefined;
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
  if ('against' in p) {
    if (!roll) return undefined;
    if ('condition' in p.against) return roll.against?.condition === p.against.condition;
    if ('concentration' in p.against) return roll.against?.concentration === true;
    const source = roll.against?.source;
    return p.against.source === 'spell' ? source === 'spell' : source === 'spell' || source === 'magic';
  }
  if ('weaponCategory' in p) return roll ? roll.attack?.category === p.weaponCategory : undefined;
  if ('weaponId' in p) return roll ? roll.attack?.weaponId === p.weaponId : undefined;
  if ('twoHanded' in p) return roll ? (roll.attack?.twoHanded ?? false) === p.twoHanded : undefined;
  if ('hasCondition' in p) return ctx.conditions.has(p.hasCondition);
  if ('species' in p) return ctx.speciesId === p.species;
  if ('not' in p) {
    const inner = evaluatePredicate(p.not, ctx);
    return inner === undefined ? undefined : !inner;
  }
  const results = ('all' in p ? p.all : p.any).map((x) => evaluatePredicate(x, ctx));
  if ('all' in p) return results.includes(false) ? false : results.includes(undefined) ? undefined : true;
  return results.includes(true) ? true : results.includes(undefined) ? undefined : false;
}

/** Rótulo de uma parcela: o traço/opção, se houver, e a fonte ("Dwarven Toughness (Dwarf)"). */
const labelOf = (e: SourcedEffect): string => (e.detail && e.detail !== e.source.name ? `${e.detail} (${e.source.name})` : e.source.name);
/** A fonte com o nome do traço ou da característica ("Remarkable Athlete (Champion)"), para os lembretes e listas das rolagens. */
const namedSource = (e: SourcedEffect): SourceLabel => ({ ...e.source, name: labelOf(e) });
const total = (parts: readonly Contribution[]): number => parts.reduce((sum, p) => sum + p.value, 0);
const stat = (parts: Contribution[]): Stat => ({ total: total(parts), parts });

export function deriveSheet(input: SheetInput): DerivedSheet {
  const { character, inventory, adjustments, compendium } = input;
  const build = resolveBuild(character, compendium);
  const issues: Issue[] = [...build.issues];
  const find = <T extends { id: string }>(list: readonly T[], id: string): T | undefined => list.find((x) => x.id === id);

  // --- Itens -------------------------------------------------------------

  const classIds = build.classes.map((c) => c.classId);
  const spellcaster = classIds.some((id) => find(compendium.classes, id)?.spellcasting !== undefined);
  const entries = resolveInventory(inventory, compendium, { classIds, spellcaster }, issues);
  const worn = entries.filter(({ entry, item }) => entry.equipped && item.kind === 'armor' && item.category !== 'shield');
  const shields = entries.filter(({ entry, item }) => entry.equipped && item.kind === 'armor' && item.category === 'shield');
  if (worn.length > 1) issues.push({ severity: 'error', code: 'multiple_armor', message: 'Só é possível vestir uma armadura por vez.' });
  if (shields.length > 1) issues.push({ severity: 'error', code: 'multiple_armor', message: 'Só é possível empunhar um escudo por vez.' });
  const armorItem = worn[0]?.item;
  const armor = armorItem?.kind === 'armor' ? armorItem : undefined;
  // As condições são preenchidas depois de avaliar os efeitos `condition` (que não dependem delas).
  const currentConditions = new Set<Condition>();
  const ctx: PredicateContext = { armor, shield: shields.length > 0, conditions: currentConditions, speciesId: build.speciesId };

  const isItemActive = (activation: Item['activation'], entry: { equipped: boolean; attuned: boolean }): boolean =>
    activation === 'carried' || (activation === 'equipped' && entry.equipped) || (activation === 'attuned' && entry.attuned);

  const all: SourcedEffect[] = [
    ...build.effects,
    ...adjustments.flatMap((adj) => {
      const source: SourceLabel = { kind: 'adjustment', id: adj.id, name: adj.name };
      return adj.effects.map((effect): SourcedEffect => ({ effect, source, refKey: adj.weapon !== undefined ? `item:${adj.weapon}` : `adjustment:${adj.id}` }));
    }),
    ...(input.conditions?.active ?? []).map((c): SourcedEffect => ({ effect: { type: 'condition', condition: c.condition }, source: TABLE_CONDITION_SOURCE, refKey: 'table:conditions' })),
    ...(input.conditions && input.conditions.exhaustion > 0
      ? [{ effect: { type: 'condition', condition: 'exhaustion', level: Math.min(input.conditions.exhaustion, MAX_EXHAUSTION) }, source: TABLE_CONDITION_SOURCE, refKey: 'table:conditions' } satisfies SourcedEffect]
      : []),
  ];

  /** A parte mágica vale quando ativa pela sua própria regra (vestido, sintonizado) e com sintonização permitida. */
  const magicActive = (magic: MagicPart | undefined, entry: InventoryEntry): boolean =>
    magic !== undefined && magic.attunable && isItemActive(magic.item.activation, entry);
  type BaseOverride = Extract<Effect, { type: 'base_override' }>;
  /** `base_override` da parte mágica ativa de cada entrada: altera o item base dela (Mithral Armor, Sun Blade). */
  const overridesOf = new Map<string, BaseOverride[]>(
    entries.map(({ entry, magic }) => [
      entry.instanceId,
      magic && magicActive(magic, entry)
        ? magic.effects.filter((e): e is BaseOverride => e.type === 'base_override' && (!e.when || evaluatePredicate(e.when, ctx) === true))
        : [],
    ]),
  );
  // Magia na arma (Shillelagh): o ajuste altera a entrada do inventário a que pertence.
  for (const adj of adjustments) {
    if (adj.weapon === undefined) continue;
    const own = adj.effects.filter((e): e is BaseOverride => e.type === 'base_override' && (!e.when || evaluatePredicate(e.when, ctx) === true));
    if (own.length > 0) overridesOf.set(adj.weapon, [...(overridesOf.get(adj.weapon) ?? []), ...own]);
  }
  const overrides = (instanceId: string): BaseOverride[] => overridesOf.get(instanceId) ?? [];
  /** Efeitos ativos de cada entrada do inventário (item base e parte mágica), com a fonte. */
  const itemEffects = entries.map(({ entry, item, magic }) => {
    const refKey = `item:${entry.instanceId}`;
    const list: SourcedEffect[] = [];
    if (item.kind !== 'magic_item' && isItemActive(item.activation, entry)) {
      const source: SourceLabel = { kind: 'item', id: item.id, name: item.name };
      const noStealthDisadvantage = overrides(entry.instanceId).some((o) => o.removeStealthDisadvantage);
      for (const effect of item.effects) {
        if (noStealthDisadvantage && effect.type === 'disadvantage' && effect.target === 'skill.stealth') continue;
        list.push({ effect, source, refKey });
      }
    }
    if (magic && magicActive(magic, entry)) {
      const source: SourceLabel = { kind: 'item', id: magic.item.id, name: magic.name };
      for (const effect of magic.effects) list.push({ effect, source, refKey });
    }
    return { entry, item, effects: list };
  });

  // Proficiências: escolhas, ajustes e itens ativos (Bracers of Archery, Elven Chain). As dos itens entram
  // antes da checagem de treinamento, para um item poder treinar o personagem com ele mesmo.
  const proficiencyEffects = [...all, ...itemEffects.flatMap((i) => i.effects)].filter((e) => e.effect.type === 'grant_proficiency');
  const has = (category: 'armor' | 'weapon', id: string): boolean =>
    proficiencyEffects.some(({ effect }) => effect.type === 'grant_proficiency' && effect.category === category && effect.id === id);
  /** Treinado com a armadura/escudo desta entrada: pela categoria, ou pelo próprio item (`id: self`). */
  const trainedWith = (instanceId: string, category: 'light' | 'medium' | 'heavy' | 'shield'): boolean =>
    has('armor', category) ||
    proficiencyEffects.some(
      ({ effect, refKey }) => effect.type === 'grant_proficiency' && effect.category === 'armor' && effect.id === 'self' && refKey === `item:${instanceId}`,
    );

  const shieldTrained = shields.every(({ entry }) => trainedWith(entry.instanceId, 'shield'));
  if (shields.length && !shieldTrained) {
    issues.push({ severity: 'warning', code: 'shield_untrained', message: 'Sem treinamento com escudo: o escudo não dá bônus de CA.' });
  }
  for (const { item, effects } of itemEffects) {
    // Escudo sem treinamento não dá CA, nem a do bônus mágico.
    if (item.kind === 'armor' && item.category === 'shield' && !shieldTrained) continue;
    all.push(...effects);
  }

  const wornEntry = worn[0]?.entry;
  const armorTrained = armor === undefined || wornEntry === undefined || trainedWith(wornEntry.instanceId, armor.category);
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
  // Aumentos de itens com teto ("+2, até o máximo de 20"), na ordem; depois os mínimos.
  for (const { effect, source } of effectsOf('ability_increase')) {
    const current = total(scoreParts[effect.ability]);
    const raise = Math.min(effect.value, effect.max - current);
    if (raise > 0) scoreParts[effect.ability].push({ label: `+${String(effect.value)} (máximo ${String(effect.max)})`, value: raise, source });
  }
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
  // Bônus de proficiência pelo nível, mais `flat_bonus` inteiros em `proficiency_bonus` (Ioun Stone of Mastery).
  const pb =
    proficiencyBonus(level) +
    effectsOf('flat_bonus')
      .filter(({ effect }) => effect.target === 'proficiency_bonus')
      .reduce((sum, { effect }) => sum + (typeof effect.value === 'number' ? effect.value : 0), 0);

  // --- Condições -----------------------------------------------------------

  const conditions: DerivedSheet['conditions'] = [];
  let exhaustion = 0;
  for (const { effect, source } of effectsOf('condition')) {
    if (effect.condition === 'exhaustion') exhaustion += effect.level;
    else conditions.push({ condition: effect.condition, source });
  }
  // Com as implícitas (Inconsciente também é Incapacitado e Caído); os efeitos nas rolagens vêm de `ownRollConditions`.
  for (const c of effectiveConditions(conditions.map((x) => x.condition))) currentConditions.add(c);
  if (exhaustion) currentConditions.add('exhaustion');
  exhaustion = Math.min(exhaustion, MAX_EXHAUSTION);
  const exhaustionPart = (): Contribution[] =>
    exhaustion ? [{ label: `Exaustão ${exhaustion}`, value: -EXHAUSTION_D20_PENALTY * exhaustion, source: RULE('exhaustion', 'Exaustão') }] : [];

  // --- Bônus e rolagens -----------------------------------------------------

  /** `perLevel` conta o nível na escala da fonte: o da classe para classe/subclasse, o de personagem nos demais. */
  const scaleLevel = (classId: string | undefined): number =>
    classId ? (build.classes.find((c) => c.classId === classId)?.level ?? 0) : level;
  const bonusValue = (value: BonusValue, classId?: string): number => {
    if (typeof value === 'number') return value;
    if ('ability' in value) return Math.max(mod(value.ability), value.min ?? -Infinity);
    if ('proficiency' in value) return value.proficiency * pb;
    return value.perLevel * scaleLevel(classId);
  };
  const bonuses = (targets: readonly string[], roll?: RollContext): Contribution[] =>
    effectsOf('flat_bonus', roll)
      .filter(({ effect }) => targets.includes(effect.target))
      .map((e) => ({ label: e.effect.note ?? labelOf(e), value: bonusValue(e.effect.value, e.classId), source: e.source }));

  /** Regra `d20_rule` resolvida (o valor do atributo em `minimum_total`). */
  const resolveRule = (effect: Extract<Effect, { type: 'd20_rule' }>, source: SourceLabel): SourcedD20Rule => {
    switch (effect.rule) {
      case 'reroll':
        return { rule: 'reroll', on: effect.on, source };
      case 'minimum_die':
        return { rule: 'minimum_die', value: effect.value, source };
      case 'minimum_total':
        return { rule: 'minimum_total', value: typeof effect.value === 'number' ? effect.value : scores[effect.value.score], source };
      case 'auto_success':
        return { rule: 'auto_success', source };
      case 'count_as_20':
        return { rule: 'count_as_20', min: effect.min, source };
    }
  };

  /**
   * Vantagem/desvantagem pelos `targets` e regras d20 por eles, mais `d20_test` e os
   * `ruleTargets` (`check.all`, `check.proficient`), que só existem para `d20_rule`.
   */
  const rollState = (
    targets: readonly string[],
    roll?: RollContext,
    extra: { kind: 'advantage' | 'disadvantage'; source: SourceLabel }[] = [],
    ruleTargets: readonly string[] = [],
    conditionRoll?: ConditionRoll,
  ): RollState => {
    const state: RollState = { mode: 'normal', advantage: [], disadvantage: [], situational: [], rules: [], situationalRules: [], autoFail: [], bonusDice: [], situationalBonusDice: [] };
    const allRuleTargets = [...targets, 'd20_test', ...ruleTargets];
    for (const e of ofType('d20_rule')) {
      const { effect } = e;
      const source = namedSource(e);
      if (!allRuleTargets.includes(effect.target)) continue;
      const result = applies(effect, roll);
      if (result === false) continue;
      const rule = resolveRule(effect, source);
      if (result === undefined || effect.note) state.situationalRules.push({ ...rule, when: effect.when, note: effect.note });
      else state.rules.push(rule);
    }
    // Dados no d20 (`d20_bonus`): os mesmos alvos das regras do d20.
    for (const e of ofType('d20_bonus')) {
      const { effect } = e;
      if (!allRuleTargets.includes(effect.target)) continue;
      const result = applies(effect, roll);
      if (result === false) continue;
      const bonus = { dice: effect.dice, subtract: effect.subtract === true, source: namedSource(e) };
      if (result === undefined || effect.note) state.situationalBonusDice.push({ ...bonus, when: effect.when, note: effect.note });
      else state.bonusDice.push(bonus);
    }
    for (const kind of ['advantage', 'disadvantage'] as const) {
      for (const e of ofType(kind)) {
        const { effect } = e;
        const source = namedSource(e);
        if (!targets.includes(effect.target)) continue;
        const result = applies(effect, roll);
        if (result === false) continue;
        if (result === undefined || effect.note) state.situational.push({ kind, source, when: effect.when, note: effect.note });
        else state[kind].push(source);
      }
    }
    for (const e of extra) state[e.kind].push(e.source);
    if (conditionRoll) {
      // Condições da criatura (Envenenado, Impedido, Paralisado…), já com as implícitas.
      const fromConditions = ownRollConditions(currentConditions, conditionRoll);
      state.advantage.push(...fromConditions.advantage);
      state.disadvantage.push(...fromConditions.disadvantage);
      state.autoFail.push(...fromConditions.autoFail);
      state.situational.push(...fromConditions.situational);
    }
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

  const halfProficiency = effectsOf('half_proficiency');
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
      return [a, { ...stat(parts), proficient, roll: rollState([`save.${a}`, 'save.all'], undefined, [], [], { kind: 'save', ability: a }) } satisfies SaveStat];
    }),
  ) as Record<Ability, SaveStat>;

  const skills = Object.fromEntries(
    SKILLS.map((skill: Skill) => {
      const ability = SKILL_ABILITY[skill];
      const proficiency = proficiencyLevel('skill', skill);
      const multiplier = proficiency === 'expertise' ? 2 : proficiency === 'proficient' ? 1 : 0;
      const targets = [`skill.${skill}`, `check.${ability}`];
      const half = multiplier === 0 ? halfProficiency[0] : undefined;
      const parts: Contribution[] = [
        { label: `Modificador de ${ABILITY_NAME[ability]}`, value: mod(ability) },
        ...(multiplier ? [{ label: multiplier === 2 ? 'Especialização' : 'Proficiência', value: pb * multiplier }] : []),
        ...(half ? [{ label: labelOf(half), value: Math.floor(pb / 2), source: half.source }] : []),
        ...bonuses(targets),
        ...exhaustionPart(),
      ];
      const roll = rollState(targets, undefined, [], ['check.all', ...(multiplier ? ['check.proficient'] : [])], { kind: 'check' });
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

  const checks = Object.fromEntries(
    ABILITIES.map((a) => {
      const targets = [`check.${a}`];
      const parts: Contribution[] = [{ label: `Modificador de ${ABILITY_NAME[a]}`, value: mod(a) }, ...bonuses(targets), ...exhaustionPart()];
      return [a, { ...stat(parts), roll: rollState(targets, undefined, [], ['check.all'], { kind: 'check' }) } satisfies RollStat];
    }),
  ) as Record<Ability, RollStat>;

  const initiativeTargets = ['initiative', 'check.dex'];
  const initiative: RollStat = {
    ...stat([{ label: 'Modificador de DES', value: mod('dex') }, ...bonuses(initiativeTargets), ...exhaustionPart()]),
    roll: rollState(initiativeTargets, undefined, [], ['check.all'], { kind: 'initiative' }),
  };

  // Salvaguarda contra a Morte: um d20 sem atributo; como salvaguarda, recebe `save.all`.
  const deathSaveTargets = ['death_save', 'save.all'];
  const deathSave: RollStat = { ...stat([...bonuses(deathSaveTargets), ...exhaustionPart()]), roll: rollState(deathSaveTargets) };

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
  const acParts = [...bestFormula, ...bonuses(['ac'])];
  // CA mínima (Barkskin): completa o que falta, depois de tudo.
  for (const { effect, source } of effectsOf('minimum_ac')) {
    const current = total(acParts);
    if (current < effect.value) acParts.push({ label: `Mínimo ${effect.value}`, value: effect.value - current, source });
  }
  const ac = stat(acParts);

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
  const wornId = worn[0]?.entry.instanceId;
  // Mithral Armor: sem exigência de FOR. Boots of Striding and Springing: a armadura não reduz o deslocamento.
  const armorStrength = wornId !== undefined && overrides(wornId).some((o) => o.removeStrength) ? undefined : armor?.strength;
  const minimumSpeeds = effectsOf('minimum_speed');
  const ignoreArmorPenalty = minimumSpeeds.some(({ effect }) => effect.ignoreArmorPenalty);
  const speedPenalties = (): Contribution[] => [
    ...(armor && armorStrength !== undefined && scores.str < armorStrength && !ignoreArmorPenalty
      ? [{ label: `${armor.name} sem FOR ${armorStrength}`, value: -HEAVY_ARMOR_SPEED_PENALTY, source: { kind: 'item', id: armor.id, name: armor.name } as SourceLabel }]
      : []),
    ...(exhaustion ? [{ label: `Exaustão ${exhaustion}`, value: -EXHAUSTION_SPEED_PENALTY * exhaustion, source: RULE('exhaustion', 'Exaustão') }] : []),
  ];
  /** Condições que zeram o deslocamento (Agarrado, Impedido, Paralisado…). */
  const speedZero = SPEED_ZERO_CONDITIONS.filter((c) => currentConditions.has(c));
  const speedStat = (kind: 'walk' | 'fly' | 'swim' | 'climb' | 'burrow', base: Contribution[]): Stat => {
    const parts = [...base, ...bonuses([`speed.${kind}`])];
    if (total(parts) <= 0) return { total: 0, parts: [] };
    const result = stat([...parts, ...speedPenalties()]);
    if (speedZero.length > 0 && result.total > 0) {
      const source = conditionSource(speedZero[0] ?? 'grappled');
      return stat([...result.parts, { label: `${speedZero.map((c) => conditionSource(c).name).join(', ')}: deslocamento 0`, value: -result.total, source }]);
    }
    return { ...result, total: Math.max(0, result.total) };
  };
  /** Deslocamento a pé mínimo ("becomes 30 feet unless your Speed is higher"), antes das penalidades. */
  const minimumWalk = (base: Contribution[]): Contribution[] => {
    const best = minimumSpeeds.reduce<(typeof minimumSpeeds)[number] | undefined>((b, e) => (!b || e.effect.value > b.effect.value ? e : b), undefined);
    const current = total([...base, ...bonuses(['speed.walk'])]);
    return best && current < best.effect.value
      ? [...base, { label: `Mínimo ${String(best.effect.value)} ft (${labelOf(best)})`, value: best.effect.value - current, source: best.source }]
      : base;
  };
  const walk = speedStat(
    'walk',
    minimumWalk(species ? [{ label: species.name, value: species.speed, source: { kind: 'species', id: species.id, name: species.name } }] : []),
  );
  /**
   * Deslocamento especial: o maior entre as concessões. "Igual ao Deslocamento" usa o total
   * a pé (já com bônus e penalidades); um valor fixo recebe as penalidades aqui.
   */
  const specialSpeed = (kind: 'fly' | 'swim' | 'climb' | 'burrow'): Stat => {
    const grants = effectsOf('grant_speed').filter(({ effect }) => effect.speed === kind);
    const candidates: Stat[] = grants.map((e) =>
      e.effect.value === 'walk'
        ? stat([{ label: `${labelOf(e)} (igual ao deslocamento)`, value: walk.total, source: e.source }, ...bonuses([`speed.${kind}`])])
        : speedStat(kind, [{ label: labelOf(e), value: e.effect.value, source: e.source }]),
    );
    if (!candidates.length) return speedStat(kind, []);
    return candidates.reduce((best, c) => (c.total > best.total ? c : best));
  };
  const speed = { walk, fly: specialSpeed('fly'), swim: specialSpeed('swim'), climb: specialSpeed('climb'), burrow: specialSpeed('burrow') };

  // --- Sentidos e defesas -----------------------------------------------------

  const senseMap = new Map<Sense, { sense: Sense; range: number; source: SourceLabel }>();
  const senseEffects = effectsOf('grant_sense');
  for (const { effect, source } of senseEffects) {
    if (effect.extend) continue;
    const current = senseMap.get(effect.sense);
    if (!current || effect.range > current.range) senseMap.set(effect.sense, { sense: effect.sense, range: effect.range, source });
  }
  // `extend`: soma ao alcance já concedido; sem outra fonte, concede (Goggles of Night).
  for (const { effect, source } of senseEffects) {
    if (!effect.extend) continue;
    const current = senseMap.get(effect.sense);
    senseMap.set(effect.sense, current ? { ...current, range: current.range + effect.range } : { sense: effect.sense, range: effect.range, source });
  }
  const groupBy = <K extends string>(list: { key: K; source: SourceLabel }[]): { key: K; sources: SourceLabel[] }[] => {
    const map = new Map<K, SourceLabel[]>();
    for (const { key, source } of list) map.set(key, [...(map.get(key) ?? []), source]);
    return [...map.entries()].map(([key, sources]) => ({ key, sources }));
  };
  const immunities = effectsOf('immunity');
  const defenses = conditionDefenses(currentConditions, {
    damageReductions: effectsOf('damage_reduction').map(({ effect, source }) => ({ damageType: effect.damageType, amount: effect.amount, source })),
    resistances: groupBy(effectsOf('resistance').map(({ effect, source }) => ({ key: effect.damageType, source }))).map(({ key, sources }) => ({ damageType: key, sources })),
    vulnerabilities: groupBy(effectsOf('vulnerability').map(({ effect, source }) => ({ key: effect.damageType, source }))).map(({ key, sources }) => ({ damageType: key, sources })),
    damageImmunities: groupBy(immunities.flatMap(({ effect, source }) => (effect.damageType ? [{ key: effect.damageType, source }] : []))).map(
      ({ key, sources }) => ({ damageType: key, sources }),
    ),
    conditionImmunities: groupBy(immunities.flatMap(({ effect, source }) => (effect.condition ? [{ key: effect.condition, source }] : []))).map(
      ({ key, sources }) => ({ condition: key, sources }),
    ),
  });

  // --- Proficiências ------------------------------------------------------------

  const uniqueIds = (category: string): string[] => [
    // `self` (treinado com o próprio item) não é uma proficiência geral: fica fora da lista.
    ...new Set(effectsOf('grant_proficiency').flatMap(({ effect }) => (effect.category === category && effect.id !== 'self' ? [effect.id] : []))),
  ];
  const proficiencies = {
    armor: uniqueIds('armor'),
    weapons: uniqueIds('weapon'),
    tools: uniqueIds('tool').map((id) => ({ id, level: proficiencyLevel('tool', id) })),
    languages: uniqueIds('language'),
  };
  const weaponMasteries = [...new Set(effectsOf('weapon_mastery').map(({ effect }) => effect.weaponId))];

  // --- Ataques ------------------------------------------------------------------

  /** Bônus `attack.weapon`/`damage.weapon` da própria entrada do inventário (arma mágica). */
  const weaponBonuses = (target: 'attack.weapon' | 'damage.weapon', instanceId: string, roll: RollContext): Contribution[] =>
    effectsOf('flat_bonus', roll)
      .filter(({ effect, refKey }) => effect.target === target && refKey === `item:${instanceId}`)
      .map((e) => ({ label: e.effect.note ?? labelOf(e), value: bonusValue(e.effect.value, e.classId), source: e.source }));

  /** A arma base com os `base_override` da entrada (Sun Blade: Finesse, dano Radiant). */
  const overriddenWeapon = (weapon: Weapon, instanceId: string): Weapon =>
    overrides(instanceId).reduce<Weapon>(
      (w, o) => ({
        ...w,
        properties: [...new Set([...w.properties, ...(o.addProperties ?? [])])],
        damage: { ...w.damage, dice: o.damageDice ?? w.damage.dice, type: o.damageType ?? w.damage.type },
        ...(w.versatileDice && o.damageDice ? { versatileDice: o.damageDice } : {}),
      }),
      weapon,
    );
  /** Proficiente com a arma, ou com alguma das armas de `proficiencyWith` ("Longswords or Shortswords"). */
  const weaponProficient = (weapon: Weapon, instanceId: string): boolean =>
    isWeaponProficient(proficiencyEffects, weapon) ||
    overrides(instanceId).some((o) =>
      (o.proficiencyWith ?? []).some((id) => {
        const other = find(compendium.items, id);
        return other?.kind === 'weapon' && isWeaponProficient(proficiencyEffects, other);
      }),
    );

  /** Círculo dos espaços de Pacto, se há. */
  const pactSlotLevel = (): number | undefined => {
    for (const c of build.classes) {
      if (find(compendium.classes, c.classId)?.spellcasting?.progression === 'pact') return pactMagicSlots(c.level)?.level;
    }
    return undefined;
  };
  /** Dano extra condicional (nota 0077); o de mesmo id que vem depois substitui, no lugar do anterior. */
  const attackRiders = (weapon: Weapon, instanceId: string, ability: Ability, roll: RollContext): AttackRider[] => {
    const found = new Map<string, AttackRider>();
    for (const e of effectsOf('attack_rider', roll)) {
      const { effect } = e;
      if (effect.scope === 'weapon' && e.refKey !== `item:${instanceId}`) continue;
      if (effect.ability !== undefined && effect.ability !== ability) continue;
      const pact = effect.cost && 'pactSlot' in effect.cost ? effect.cost : undefined;
      const pactLevel = pact ? pactSlotLevel() : undefined;
      if (pact && pactLevel === undefined) continue;
      const base = typeof effect.dice === 'string' ? effect.dice : effect.dice.byLevel[Math.max(1, scaleLevel(e.classId)) - 1];
      if (base === undefined) continue;
      const { cost } = effect;
      found.set(effect.id, {
        id: effect.id,
        name: effect.name,
        dice: pact && pactLevel !== undefined ? addDice(base, pact.perSlotLevel, pactLevel) : base,
        types: effect.damageType === undefined ? [weapon.damage.type] : typeof effect.damageType === 'string' ? [effect.damageType] : effect.damageType,
        mode: effect.mode,
        oncePerTurn: effect.oncePerTurn === true,
        ...(effect.ability ? { ability: effect.ability } : {}),
        ...(effect.onlyTypes ? { onlyTypes: effect.onlyTypes } : {}),
        ...(effect.exceptTypes ? { exceptTypes: effect.exceptTypes } : {}),
        injured: effect.injured === true,
        natural20: effect.natural20 === true,
        sneak: effect.sneak === true,
        ...(cost ? { cost: 'resource' in cost ? { kind: 'resource' as const, resourceId: cost.resource } : 'charges' in cost ? { kind: 'charges' as const, amount: cost.charges } : { kind: 'pact_slot' as const } } : {}),
        ...(effect.note !== undefined ? { note: effect.note } : {}),
        source: namedSource(e),
      });
    }
    return [...found.values()];
  };

  const attackFor = (base: Weapon, instanceId: string, name: string): WeaponAttack => {
    const weapon = overriddenWeapon(base, instanceId);
    const finesse = weapon.properties.includes('finesse');
    const allowed: Ability[] = weapon.attackKind === 'ranged' ? ['dex'] : finesse ? ['str', 'dex'] : ['str'];
    const ctxForAbility: RollContext = { attack: { kind: weapon.attackKind, properties: weapon.properties, category: weapon.category, weaponId: weapon.id } };
    for (const { effect, refKey } of effectsOf('attack_ability', ctxForAbility)) {
      if (effect.scope !== 'weapon' || refKey === `item:${instanceId}`) allowed.push(effect.ability);
    }
    // O maior modificador entre os permitidos; empate fica com o primeiro (o atributo normal da arma).
    const ability = allowed.reduce((best, a) => (mod(a) > mod(best) ? a : best));
    const proficient = weaponProficient(weapon, instanceId);
    const attackCtx: RollContext = {
      attack: { kind: weapon.attackKind, properties: weapon.properties, category: weapon.category, weaponId: weapon.id, twoHanded: weapon.properties.includes('two_handed') },
    };
    const versatileCtx: RollContext | undefined = weapon.versatileDice && attackCtx.attack ? { attack: { ...attackCtx.attack, twoHanded: true } } : undefined;
    /** O maior `damage_die_minimum` que vale no contexto (Great Weapon Fighting). */
    const dieMinimum = (roll: RollContext): { value: number; source: SourceLabel } | undefined =>
      effectsOf('damage_die_minimum', roll).reduce<{ value: number; source: SourceLabel } | undefined>(
        (best, e) => (!best || e.effect.min > best.value ? { value: e.effect.min, source: namedSource(e) } : best),
        undefined,
      );
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
      ...weaponBonuses('attack.weapon', instanceId, attackCtx),
      ...exhaustionPart(),
    ];
    const damageParts: Contribution[] = [
      { label: `Modificador de ${ABILITY_NAME[ability]}`, value: mod(ability) },
      ...bonuses([`damage.${weapon.attackKind}`], attackCtx),
      ...weaponBonuses('damage.weapon', instanceId, attackCtx),
    ];
    return {
      itemId: weapon.id,
      instanceId,
      name,
      kind: weapon.attackKind,
      ability,
      proficient,
      attack: { ...stat(attackParts), roll: rollState([`attack.${weapon.attackKind}`, 'attack.all'], attackCtx, extra, [], { kind: 'attack' }) },
      damage: { dice: weapon.damage.dice, bonus: stat(damageParts), type: weapon.damage.type, dieMinimum: dieMinimum(attackCtx) },
      extraDamage: effectsOf('extra_damage', attackCtx)
        .filter(({ effect, refKey }) => effect.scope !== 'weapon' || refKey === `item:${instanceId}`)
        .map((e) => ({ dice: e.effect.dice, type: e.effect.damageType ?? weapon.damage.type, source: namedSource(e) })),
      riders: attackRiders(weapon, instanceId, ability, attackCtx),
      critRange: Math.min(CRITICAL_HIT, ...effectsOf('crit_range', attackCtx).map(({ effect }) => effect.min)),
      versatileDice: weapon.versatileDice,
      versatileDieMinimum: versatileCtx ? dieMinimum(versatileCtx) : undefined,
      range: weapon.range,
      reach: weapon.attackKind === 'melee' ? DEFAULT_REACH + (weapon.properties.includes('reach') ? REACH_BONUS : 0) : 0,
      mastery: { property: weapon.mastery, available: weaponMasteries.includes(weapon.id) },
    };
  };
  const attacks = entries.flatMap(({ entry, item, magic }) =>
    entry.equipped && item.kind === 'weapon' ? [attackFor(item, entry.instanceId, magic ? `${magic.name} (${item.name})` : item.name)] : [],
  );

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
  let pactSlots: { count: number; level: number } | undefined;
  const casterClasses: ClassSpellcasting[] = [];
  for (const { classId, level: classLevel } of build.classes) {
    const cls = find(compendium.classes, classId);
    if (!cls?.spellcasting) continue;
    const { ability, progression, preparedSpells } = cls.spellcasting;
    if (progression === 'pact') {
      pactSlots = pactMagicSlots(classLevel);
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
  const usesCount = (uses: GrantedSpell['uses'], classId: string | undefined): number | undefined => {
    if (typeof uses === 'string') return undefined;
    const { count } = uses;
    if (typeof count === 'number') return count;
    if ('proficiency' in count) return count.proficiency * pb;
    return count.byLevel[Math.max(1, scaleLevel(classId)) - 1];
  };
  const granted: GrantedSpell[] = effectsOf('grant_spell').flatMap(({ effect, source, refKey, classId }) => {
    const ability = typeof effect.ability === 'string' ? effect.ability : build.abilityChoices.get(refKey)?.get(effect.ability.choice);
    if (!ability) return []; // escolha de atributo pendente (já listada em `pending`)
    return [{ spellId: effect.spellId, ability, uses: effect.uses, count: usesCount(effect.uses, classId), saveDc: spellDc(ability).total, attackBonus: spellAttack(ability).total, source }];
  });

  // Sintonização: até 3 itens, mais os efeitos `attunement_slots`.
  const attunementLimit = MAX_ATTUNED_ITEMS + total(bonuses(['attunement_slots']));
  const attuned = inventory.items.filter((i) => i.attuned).length;
  if (attuned > attunementLimit) {
    issues.push({ severity: 'error', code: 'too_many_attuned', message: `${String(attuned)} itens sintonizados; o limite é ${String(attunementLimit)}.` });
  }

  const resolved = new Map(entries.map((e) => [e.entry.instanceId, e]));
  const chargesLine = (charged: ChargedItem, entry: Inventory['items'][number]): NonNullable<InventoryLine['charges']> => ({
    max: charged.max,
    available: availableCharges(charged.max, entry),
    ...(charged.regain !== undefined ? { regain: charged.regain } : {}),
    spells: (charged.item.casting?.spells ?? []).flatMap((s) => {
      const spell = find(compendium.spells, s.spellId);
      if (!spell) return [];
      return [{ spellId: s.spellId, name: spell.name, level: spell.level, ...(s.note !== undefined ? { note: s.note } : {}), costs: itemSpellCosts(s).map((charges) => ({ charges, level: itemSpellLevel(s, spell.level, charges) })) }];
    }),
  });
  const scrollLine = (entry: Inventory['items'][number]): NonNullable<InventoryLine['scroll']> => {
    const spell = entry.spellId !== undefined ? find(compendium.spells, entry.spellId) : undefined;
    if (!spell) return { spell: null, problem: 'Sem magia definida' };
    const reading = scrollReading(spell, { spellcasting: { classes: casterClasses, slots: spellSlots(casterLevel), pactSlots }, abilities });
    return { spell: spell.name, ...(reading.onList ? {} : { problem: 'Fora da lista de magias' }), ...(reading.checkDc !== undefined ? { checkDc: reading.checkDc } : {}) };
  };
  const inventoryLines: InventoryLine[] = inventory.items.map((entry) => {
    const r = resolved.get(entry.instanceId);
    const item = find(compendium.items, entry.itemId);
    const magicItem = item?.kind === 'magic_item' ? item : undefined;
    const base = r && r.magic && r.item.id !== r.magic.item.id ? ` (${r.item.name})` : '';
    const charged = chargedItem(item);
    const scroll = scrollOf(item, entry.variantId);
    const use = item && r ? itemUse(item, entry.variantId) : undefined;
    const active = r === undefined ? false : r.magic ? magicActive(r.magic, entry) : isItemActive(r.item.activation, entry);
    return {
      instanceId: entry.instanceId,
      itemId: entry.itemId,
      name: r?.magic ? `${r.magic.name}${base}` : (item?.name ?? entry.itemId),
      kind: r?.item.kind,
      quantity: entry.quantity,
      equipped: entry.equipped,
      attuned: entry.attuned,
      requiresAttunement: magicItem?.attunement !== undefined || item?.activation === 'attuned',
      active,
      ...(scroll ? { scroll: scrollLine(entry) } : {}),
      ...(r && charged ? { charges: chargesLine(charged, entry) } : {}),
      ...(use ? { use: { targets: use.targets, options: itemUseOptions(use) } } : {}),
    };
  });

  // --- Momentos do combate (nota 0043) -------------------------------------

  const triggers: SheetTrigger[] = [
    ...effectsOf('reminder').map((e): SheetTrigger => ({ kind: 'reminder', on: e.effect.on, text: e.effect.note, source: namedSource(e) })),
    ...effectsOf('turn_start_heal').map(
      (e): SheetTrigger => ({
        kind: 'heal',
        on: 'turn_start',
        amount: Math.max(0, e.effect.value + (e.effect.ability ? mod(e.effect.ability) : 0)),
        bloodiedOnly: e.effect.bloodiedOnly,
        source: namedSource(e),
      }),
    ),
  ];

  // --- Recursos (nota 0052) --------------------------------------------------

  /** Mesmo recurso de várias fontes: o maior máximo e a recarga mais generosa. */
  const RECHARGE_RANK = { long_rest: 0, short_rest_one: 1, short_rest: 2 } as const;
  const resourceMap = new Map<string, SheetResource>();
  for (const e of effectsOf('resource')) {
    const { max } = e.effect;
    const value = typeof max === 'object' && 'byLevel' in max ? (max.byLevel[Math.max(1, scaleLevel(e.classId)) - 1] ?? 0) : bonusValue(max, e.classId);
    const known = resourceMap.get(e.effect.id);
    resourceMap.set(e.effect.id, {
      id: e.effect.id,
      name: known?.name ?? e.effect.name,
      max: Math.max(known?.max ?? 0, value),
      recharge: known && RECHARGE_RANK[known.recharge] > RECHARGE_RANK[e.effect.recharge] ? known.recharge : e.effect.recharge,
      source: known?.source ?? namedSource(e),
    });
  }
  // Magias concedidas com usos por descanso viram recursos (`spell_<id>`; nota 0053).
  for (const g of granted) {
    if (typeof g.uses === 'string' || g.count === undefined || g.count <= 0) continue;
    const id = `spell_${g.spellId}`;
    const known = resourceMap.get(id);
    const recharge = g.uses.per === 'short_rest' ? 'short_rest' : 'long_rest';
    resourceMap.set(id, {
      id,
      name: known?.name ?? find(compendium.spells, g.spellId)?.name ?? g.spellId,
      max: Math.max(known?.max ?? 0, g.count),
      recharge: known && RECHARGE_RANK[known.recharge] > RECHARGE_RANK[recharge] ? known.recharge : recharge,
      source: known?.source ?? g.source,
    });
  }
  const resources = [...resourceMap.values()].filter((r) => r.max > 0);

  // --- Magias conjuráveis (nota 0053) -----------------------------------------

  const castableMap = new Map<string, CastableSpell>();
  const addCastable = (spellId: string, slots: boolean, free: CastableSpell['free'], ability: Ability): void => {
    const spell = find(compendium.spells, spellId);
    if (!spell) return;
    const known = castableMap.get(spellId);
    const casters = known?.casters ?? [];
    if (!casters.some((c) => c.ability === ability)) {
      casters.push({ ability, saveDc: spellDc(ability).total, attack: spellAttack(ability) });
      casters.sort((a, b) => b.saveDc - a.saveDc || b.attack.total - a.attack.total);
    }
    castableMap.set(spellId, {
      spellId,
      level: spell.level,
      ritual: spell.ritual,
      concentration: spell.concentration,
      slots: (known?.slots ?? false) || (slots && spell.level > 0),
      free: known?.free ?? free,
      casters,
    });
  };
  for (const c of casterClasses) {
    for (const id of c.cantrips) addCastable(id, false, 'cantrip', c.ability);
    for (const id of c.spells) addCastable(id, true, undefined, c.ability);
  }
  for (const g of granted) {
    const spellLevel = find(compendium.spells, g.spellId)?.level ?? 0;
    if (g.uses === 'at_will' || spellLevel === 0) addCastable(g.spellId, false, spellLevel === 0 ? 'cantrip' : 'at_will', g.ability);
    else if (g.uses === 'slot') addCastable(g.spellId, true, undefined, g.ability);
    else addCastable(g.spellId, g.uses.slots === true, { resourceId: `spell_${g.spellId}` }, g.ability);
  }
  const castable = [...castableMap.values()];
  // Ataque de magia: as Vantagens e Desvantagens de `attack.spell` e `attack.all`, e as condições de quem conjura.
  const spellAttackRoll = rollState(['attack.spell', 'attack.all'], { attack: { kind: 'spell', properties: [] } }, [], [], { kind: 'attack' });

  // --- Concentração (nota 0045) ---------------------------------------------

  /** Magias do personagem que exigem Concentração (truques, conhecidas, concedidas), sem repetir. */
  const concentrationSpells = [
    ...new Set([...casterClasses.flatMap((c) => [...c.cantrips, ...c.spells]), ...granted.map((g) => g.spellId)]),
  ].filter((id) => find(compendium.spells, id)?.concentration === true);
  const keepConcentration = [...new Set(effectsOf('keep_concentration').map(({ effect }) => effect.spellId))];

  const errors = issues.filter((i) => i.severity === 'error');
  const vision = deriveVisionProfile(
    all.filter((e) => applies(e.effect) === true).map((e) => e.effect),
    currentConditions,
  );
  return {
    complete: build.pending.length === 0 && errors.length === 0,
    pending: build.pending,
    issues,
    levelUp: build.levelUp,
    inventory: inventoryLines,
    featureUses: resolveFeatureUses(
      effectsOf('feature_use').map((e) => ({ effect: e.effect, classId: e.classId, source: namedSource(e) })),
      effectsOf('feature_use_part').map((e) => ({ effect: e.effect, classId: e.classId, source: namedSource(e) })),
      { bonus: bonusValue, scaleLevel, spellDc: (classId) => casterClasses.find((c) => c.classId === classId)?.saveDc.total },
    ),
    selfInspirations: resolveSelfInspirations(
      effectsOf('self_inspiration').map((e) => ({ effect: e.effect, classId: e.classId, source: namedSource(e) })),
      scaleLevel,
    ),
    attunement: { used: attuned, limit: attunementLimit },
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
    deathSave,
    speed,
    saves,
    skills,
    checks,
    senses: [...senseMap.values()],
    vision,
    defenses,
    attacksAgainst: effectsOf('attacks_against').map((e) => ({
      mode: e.effect.mode,
      ...(e.effect.from ? { from: e.effect.from } : {}),
      ...(e.effect.note !== undefined ? { note: e.effect.note } : {}),
      source: namedSource(e),
    })),
    proficiencies,
    weaponMasteries,
    attacks,
    spellcasting: { classes: casterClasses, slots: spellSlots(casterLevel), pactSlots, granted, canCast: armorTrained, concentration: concentrationSpells, keepConcentration, castable, attackRoll: spellAttackRoll },
    feats: build.feats,
    features: build.features,
    conditions,
    exhaustion,
    triggers,
    resources,
  };
}
