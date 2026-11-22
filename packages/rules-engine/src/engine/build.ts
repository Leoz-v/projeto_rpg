import { ABILITIES, type Ability, type AbilityScores, SKILLS, type Size, type Skill } from '../schemas/common';
import type { BuildStep, Character, Selection } from '../schemas/character';
import type { Effect } from '../schemas/effect';
import type { Item, Weapon } from '../schemas/item';
import type { ChoiceOptions, Class, Feat, Grant, LevelGrants } from '../schemas/source';
import type { Spell } from '../schemas/spell';
import type { Compendium } from '../srd';
import { isWeaponProficient } from './proficiency';
import type { Contribution, Issue, PendingChoice, SheetFeature, SourceLabel } from './types';

/**
 * Resolução da lista de escolhas: percorre os passos em ordem, aplica o que
 * cada fonte concede ao atingir cada nível, casa cada escolha com a seleção do
 * jogador, valida e registra o que ficou pendente. Não calcula números finais
 * (ver `sheet.ts`).
 */

/** Efeito com a fonte e a chave usada para resolver referências `{ choice }`. */
export interface SourcedEffect {
  effect: Effect;
  source: SourceLabel;
  refKey: string;
  /** Traço ou opção de onde o efeito veio (ex.: "Dwarven Toughness", "High Elf"). */
  detail?: string | undefined;
  /** Classe da escala da fonte (classe/subclasse), para `perLevel` contar o nível da classe. */
  classId?: string | undefined;
}

export interface ResolvedBuild {
  level: number;
  classes: { classId: string; level: number; subclassId?: string | undefined }[];
  /** Ordem em que cada nível de classe foi obtido (para PV). */
  levelOrder: string[];
  speciesId?: string | undefined;
  backgroundId?: string | undefined;
  size?: Size | undefined;
  /** Valores de atributo após base, antecedente e aumentos de talentos, com a conta. */
  scores: Record<Ability, Contribution[]>;
  effects: SourcedEffect[];
  features: SheetFeature[];
  feats: { featId: string; source: SourceLabel }[];
  /** Magias escolhidas pela conjuração de cada classe. */
  classSpells: Map<string, { cantrips: string[]; spells: string[] }>;
  /** Atributos escolhidos em escolhas `ability`, por chave de fonte. */
  abilityChoices: Map<string, Map<string, Ability>>;
  pending: PendingChoice[];
  issues: Issue[];
}

const ABILITY_NAME: Record<Ability, string> = { str: 'FOR', dex: 'DES', con: 'CON', int: 'INT', wis: 'SAB', cha: 'CAR' };
const BACKGROUND_SCORE_CAP = 20;
const MULTICLASS_MINIMUM = 13;

type Scale = { kind: 'character' } | { kind: 'class'; classId: string };

interface LeveledSource {
  source: SourceLabel;
  refKey: string;
  scale: Scale;
  levels: LevelGrants;
  detail?: string | undefined;
  /** Último nível já aplicado. */
  done: number;
}

function isSkill(id: string): id is Skill {
  return (SKILLS as readonly string[]).includes(id);
}

export function resolveBuild(character: Character, compendium: Compendium): ResolvedBuild {
  const find = <T extends { id: string }>(list: readonly T[], id: string): T | undefined => list.find((x) => x.id === id);

  const issues: Issue[] = [];
  const pending: PendingChoice[] = [];
  const effects: SourcedEffect[] = [];
  const features: SheetFeature[] = [];
  const feats: { featId: string; source: SourceLabel }[] = [];
  const classSpells = new Map<string, { cantrips: string[]; spells: string[] }>();
  const abilityChoices = new Map<string, Map<string, Ability>>();
  const leveled: LeveledSource[] = [];
  const classLevels = new Map<string, number>();
  const subclasses = new Map<string, string>();
  const levelOrder: string[] = [];
  const expertiseChecks: { skill: Skill; stepIndex: number; choiceId: string }[] = [];
  const masteredWeapons = new Set<string>();
  const masteryChecks: { weapon: Weapon; stepIndex: number; choiceId: string }[] = [];
  /** Opções já escolhidas por grupo (`fonte:grupo`), para unicidade e pré-requisitos. */
  const optionGroups = new Map<string, string[]>();

  const scoreValues: AbilityScores = { ...character.baseScores.scores };
  const scores = Object.fromEntries(
    ABILITIES.map((a) => [a, [{ label: 'Valor base', value: character.baseScores.scores[a] } satisfies Contribution]]),
  ) as Record<Ability, Contribution[]>;

  let speciesId: string | undefined;
  let backgroundId: string | undefined;
  let size: Size | undefined;
  let characterLevel = 0;
  let firstClassId: string | undefined;
  let offersFightingStyle = false;

  // Estado do passo atual.
  let stepIndex = 0;
  let selections: readonly Selection[] = [];
  let used = new Set<number>();

  const error = (code: Issue['code'], message: string, choiceId?: string): void => {
    issues.push({ severity: 'error', code, message, stepIndex, choiceId });
  };

  const increaseScore = (ability: Ability, amount: number, cap: number, label: string, source: SourceLabel, choiceId?: string): void => {
    scoreValues[ability] += amount;
    scores[ability].push({ label, value: amount, source });
    if (scoreValues[ability] > cap) {
      error('invalid_selection', `${ABILITY_NAME[ability]} passaria de ${cap} (${source.name}).`, choiceId);
    }
  };

  const classLabel = (cls: Class): SourceLabel => ({ kind: 'class', id: cls.id, name: cls.name });
  const classOf = (scale: Scale): string | undefined => (scale.kind === 'class' ? scale.classId : undefined);

  // --- Concessões ----------------------------------------------------------

  const processGrants = (grants: readonly Grant[], source: SourceLabel, refKey: string, scale: Scale, detail?: string): void => {
    for (const grant of grants) {
      switch (grant.kind) {
        case 'effect':
          effects.push({ effect: grant.effect, source, refKey, detail, classId: classOf(scale) });
          break;
        case 'feature':
          features.push({ feature: grant.feature, source });
          for (const effect of grant.feature.effects) effects.push({ effect, source, refKey, detail: grant.feature.name, classId: classOf(scale) });
          break;
        case 'feat':
          acquireFeat(grant.featId, source);
          break;
        case 'choice':
          processChoice(grant, source, refKey, scale);
          break;
        case 'ability_increase':
          increaseScore(grant.ability, grant.amount, grant.max, detail ?? source.name, source);
          break;
      }
    }
  };

  const acquireFeat = (featId: string, via: SourceLabel, choiceId?: string): void => {
    const feat = find(compendium.feats, featId);
    if (!feat) {
      error('unknown_reference', `Talento desconhecido: ${featId} (${via.name}).`, choiceId);
      return;
    }
    if (!feat.repeatable && feats.some((f) => f.featId === featId)) {
      error('duplicate_feat', `${feat.name} não pode ser obtido mais de uma vez.`, choiceId);
    }
    checkFeatPrerequisites(feat, choiceId);
    const source: SourceLabel = { kind: 'feat', id: feat.id, name: feat.name };
    feats.push({ featId: feat.id, source });
    processGrants(feat.grants, source, `feat:${feat.id}@${stepIndex}`, { kind: 'character' });
  };

  const checkFeatPrerequisites = (feat: Feat, choiceId?: string): void => {
    const pre = feat.prerequisite;
    if (!pre) return;
    if (pre.minLevel !== undefined && characterLevel < pre.minLevel) {
      error('prerequisite_not_met', `${feat.name} exige nível ${pre.minLevel}.`, choiceId);
    }
    if (pre.anyAbilityAtLeast) {
      const entries = Object.entries(pre.anyAbilityAtLeast) as [Ability, number][];
      if (!entries.some(([a, min]) => scoreValues[a] >= min)) {
        const text = entries.map(([a, min]) => `${ABILITY_NAME[a]} ${min}`).join(' ou ');
        error('prerequisite_not_met', `${feat.name} exige ${text}.`, choiceId);
      }
    }
    if (pre.feature === 'fighting_style' && !offersFightingStyle) {
      error('prerequisite_not_met', `${feat.name} exige a característica Estilo de Luta.`, choiceId);
    }
    if (pre.feature === 'spellcasting') {
      const casts = [...classLevels.keys()].some((id) => find(compendium.classes, id)?.spellcasting !== undefined);
      if (!casts) error('prerequisite_not_met', `${feat.name} exige a característica Conjuração.`, choiceId);
    }
  };

  const takeSelection = (source: SourceLabel, choiceId: string): Selection | undefined => {
    const index = selections.findIndex(
      (s, i) => !used.has(i) && s.source.kind === source.kind && s.source.id === source.id && s.choiceId === choiceId,
    );
    if (index < 0) return undefined;
    used.add(index);
    return selections[index];
  };

  const processChoice = (grant: Extract<Grant, { kind: 'choice' }>, source: SourceLabel, refKey: string, scale: Scale): void => {
    const { options } = grant;
    if (options.pick === 'feat' && options.categories.includes('fighting_style')) offersFightingStyle = true;

    const selection = takeSelection(source, grant.id);
    if (!selection) {
      pending.push({ stepIndex, source, choiceId: grant.id, count: grant.count, options });
      return;
    }
    const picks = selection.picks;
    const fail = (message: string): void => {
      error('invalid_selection', `${source.name} — ${grant.id}: ${message}`, grant.id);
    };
    if (picks.length !== grant.count) {
      fail(`esperava ${grant.count} escolha(s), recebeu ${picks.length}.`);
      return;
    }
    if (options.pick !== 'ability_score' && new Set(picks).size !== picks.length) {
      fail('escolha repetida.');
      return;
    }
    applyPicks(options, picks, grant.id, source, refKey, scale, fail);
  };

  const applyPicks = (
    options: ChoiceOptions,
    picks: readonly string[],
    choiceId: string,
    source: SourceLabel,
    refKey: string,
    scale: Scale,
    fail: (message: string) => void,
  ): void => {
    const notAllowed = (from: readonly string[] | undefined): string[] => (from ? picks.filter((p) => !from.includes(p)) : []);
    switch (options.pick) {
      case 'proficiency': {
        const outside = notAllowed(options.from);
        if (outside.length) { fail(`fora das opções: ${outside.join(', ')}.`); return; }
        for (const id of picks) {
          const asSkill = options.categories.includes('skill') && isSkill(id);
          if (asSkill) {
            effects.push({ effect: { type: 'grant_proficiency', category: 'skill', id }, source, refKey, classId: classOf(scale) });
          } else if (options.categories.includes('tool')) {
            effects.push({ effect: { type: 'grant_proficiency', category: 'tool', id }, source, refKey, classId: classOf(scale) });
          } else if (options.categories.includes('language')) {
            effects.push({ effect: { type: 'grant_proficiency', category: 'language', id }, source, refKey, classId: classOf(scale) });
          } else {
            fail(`${id} não é uma perícia.`);
          }
        }
        return;
      }
      case 'skill_expertise': {
        const outside = notAllowed(options.from);
        if (outside.length) { fail(`fora das opções: ${outside.join(', ')}.`); return; }
        for (const id of picks) {
          if (!isSkill(id)) {
            fail(`${id} não é uma perícia.`);
            continue;
          }
          expertiseChecks.push({ skill: id, stepIndex, choiceId });
          effects.push({ effect: { type: 'grant_proficiency', category: 'skill', id, level: 'expertise' }, source, refKey, classId: classOf(scale) });
        }
        return;
      }
      case 'ability': {
        const [ability] = picks;
        const from: readonly string[] = options.from;
        if (ability === undefined || !from.includes(ability)) { fail(`atributo fora das opções: ${String(ability)}.`); return; }
        const map = abilityChoices.get(refKey) ?? new Map<string, Ability>();
        map.set(choiceId, ability as Ability);
        abilityChoices.set(refKey, map);
        return;
      }
      case 'ability_score': {
        const from: readonly string[] = options.from ?? ABILITIES;
        const outside = picks.filter((p) => !from.includes(p));
        if (outside.length) { fail(`atributo fora das opções: ${outside.join(', ')}.`); return; }
        for (const a of picks as Ability[]) increaseScore(a, 1, options.max, source.name, source, choiceId);
        return;
      }
      case 'feat': {
        for (const featId of picks) {
          const feat = find(compendium.feats, featId);
          if (feat && !options.categories.includes(feat.category)) {
            fail(`${feat.name} não é de uma categoria permitida (${options.categories.join(', ')}).`);
            continue;
          }
          acquireFeat(featId, source, choiceId);
        }
        return;
      }
      case 'weapon_mastery': {
        for (const weaponId of picks) {
          const item: Item | undefined = find(compendium.items, weaponId);
          if (item?.kind !== 'weapon') {
            fail(`${weaponId} não é uma arma conhecida.`);
            continue;
          }
          if (masteredWeapons.has(weaponId)) {
            fail(`${item.name} já tem maestria.`);
            continue;
          }
          if (options.melee && item.attackKind !== 'melee') {
            fail(`${item.name} não é uma arma corpo a corpo.`);
            continue;
          }
          if (options.proficient) masteryChecks.push({ weapon: item, stepIndex, choiceId });
          masteredWeapons.add(weaponId);
          effects.push({ effect: { type: 'weapon_mastery', weaponId }, source, refKey, classId: classOf(scale) });
        }
        return;
      }
      case 'subclass': {
        const [subclassId] = picks;
        const sub = subclassId === undefined ? undefined : find(compendium.subclasses, subclassId);
        if (!sub) { fail(`subclasse desconhecida: ${String(subclassId)}.`); return; }
        if (source.kind !== 'class' || sub.classId !== source.id) { fail(`${sub.name} não é subclasse de ${source.name}.`); return; }
        if (subclasses.has(sub.classId)) { fail(`${source.name} já tem subclasse.`); return; }
        subclasses.set(sub.classId, sub.id);
        leveled.push({
          source: { kind: 'subclass', id: sub.id, name: sub.name },
          refKey: `subclass:${sub.id}`,
          scale: { kind: 'class', classId: sub.classId },
          levels: sub.levels,
          done: 0,
        });
        return;
      }
      case 'spell': {
        const unknown: string[] = [];
        for (const spellId of picks) {
          const spell: Spell | undefined = find(compendium.spells, spellId);
          if (!spell) {
            unknown.push(spellId);
          } else {
            if (spell.level < options.minLevel || spell.level > options.maxLevel) fail(`${spell.name} é de nível ${spell.level}.`);
            if (!spell.classes.some((c) => options.lists.includes(c))) fail(`${spell.name} não está na lista ${options.lists.join('/')}.`);
            if (options.school && spell.school !== options.school) fail(`${spell.name} não é da escola ${options.school}.`);
          }
          if (options.grantAs) {
            effects.push({
              effect: { type: 'grant_spell', spellId, ability: options.grantAs.ability, uses: options.grantAs.uses },
              source,
              refKey,
              classId: classOf(scale),
            });
          } else {
            const classId = scale.kind === 'class' ? scale.classId : undefined;
            if (!classId) {
              fail('escolha de magia sem classe nem grantAs.');
              continue;
            }
            const list = classSpells.get(classId) ?? { cantrips: [], spells: [] };
            (options.maxLevel === 0 ? list.cantrips : list.spells).push(spellId);
            classSpells.set(classId, list);
          }
        }
        if (unknown.length) {
          error('unknown_reference', `Magia(s) desconhecida(s): ${unknown.join(', ')}.`, choiceId);
        }
        return;
      }
      case 'option': {
        const groupKey = options.group ? `${source.kind}:${source.id}:${options.group}` : undefined;
        const taken = groupKey ? (optionGroups.get(groupKey) ?? []) : [];
        const afterPick = [...taken, ...picks];
        for (const optionId of picks) {
          const option = options.options.find((o) => o.id === optionId);
          if (!option) {
            fail(`opção desconhecida: ${optionId}.`);
            continue;
          }
          if (taken.includes(optionId) && !option.repeatable) {
            fail(`${option.name} já foi escolhida.`);
            continue;
          }
          const pre = option.prerequisite;
          if (pre?.minLevel !== undefined && currentLevel(scale) < pre.minLevel) {
            error('prerequisite_not_met', `${option.name} exige nível ${pre.minLevel}.`, choiceId);
          }
          const missing = (pre?.options ?? []).filter((o) => !afterPick.includes(o));
          if (missing.length) error('prerequisite_not_met', `${option.name} exige: ${missing.join(', ')}.`, choiceId);
          processGrants(option.grants, source, refKey, scale, option.name);
          if (option.levels.length) leveled.push({ source, refKey, scale, levels: option.levels, detail: option.name, done: 0 });
        }
        if (groupKey) optionGroups.set(groupKey, afterPick);
        return;
      }
    }
  };

  // --- Níveis ----------------------------------------------------------------

  const currentLevel = (scale: Scale): number =>
    scale.kind === 'character' ? Math.max(1, characterLevel) : (classLevels.get(scale.classId) ?? 0);

  /** Aplica, em todas as fontes com níveis, os níveis já alcançados e ainda não aplicados. */
  const advanceLeveled = (): void => {
    for (let i = 0; i < leveled.length; i++) {
      const entry = leveled[i];
      if (!entry) continue;
      const target = currentLevel(entry.scale);
      const due = entry.levels.filter((l) => l.level > entry.done && l.level <= target).sort((a, b) => a.level - b.level);
      entry.done = Math.max(entry.done, target);
      for (const level of due) processGrants(level.grants, entry.source, entry.refKey, entry.scale, entry.detail);
    }
  };

  // --- Passos ----------------------------------------------------------------

  const applyStep = (step: BuildStep): void => {
    switch (step.kind) {
      case 'species': {
        const species = find(compendium.species, step.speciesId);
        if (!species) { error('unknown_reference', `Espécie desconhecida: ${step.speciesId}.`); return; }
        speciesId = species.id;
        if (step.size !== undefined) {
          if (!species.sizes.includes(step.size)) error('invalid_selection', `${species.name} não pode ter tamanho ${step.size}.`);
          size = step.size;
        } else if (species.sizes.length === 1) {
          size = species.sizes[0];
        } else {
          error('size_required', `Escolha o tamanho de ${species.name}.`);
        }
        const label: SourceLabel = { kind: 'species', id: species.id, name: species.name };
        leveled.push({ source: label, refKey: `species:${species.id}`, scale: { kind: 'character' }, levels: species.levels, done: 0 });
        processGrants(compendium.creation.grants, { kind: 'creation', id: 'character', name: 'Criação de personagem' }, 'creation:character', {
          kind: 'character',
        });
        return;
      }
      case 'background': {
        const background = find(compendium.backgrounds, step.backgroundId);
        if (!background) { error('unknown_reference', `Antecedente desconhecido: ${step.backgroundId}.`); return; }
        backgroundId = background.id;
        const label: SourceLabel = { kind: 'background', id: background.id, name: background.name };
        for (const [ability, amount] of Object.entries(step.abilityIncreases) as [Ability, number][]) {
          if (!background.abilityOptions.includes(ability)) {
            error('invalid_selection', `${background.name} não aumenta ${ABILITY_NAME[ability]}.`);
          }
          increaseScore(ability, amount, BACKGROUND_SCORE_CAP, background.name, label);
        }
        leveled.push({ source: label, refKey: `background:${background.id}`, scale: { kind: 'character' }, levels: background.levels, done: 0 });
        return;
      }
      case 'class_level': {
        const cls = find(compendium.classes, step.classId);
        if (!cls) { error('unknown_reference', `Classe desconhecida: ${step.classId}.`); return; }
        const previous = classLevels.get(cls.id) ?? 0;
        if (previous === 0 && firstClassId !== undefined) checkMulticlass(cls);
        classLevels.set(cls.id, previous + 1);
        characterLevel += 1;
        levelOrder.push(cls.id);
        const label = classLabel(cls);
        const scale: Scale = { kind: 'class', classId: cls.id };
        if (previous === 0) {
          const isFirst = firstClassId === undefined;
          firstClassId ??= cls.id;
          processGrants(isFirst ? cls.startingGrants : cls.multiclassGrants, label, `class:${cls.id}`, scale);
          leveled.push({ source: label, refKey: `class:${cls.id}`, scale, levels: cls.levels, done: 0 });
        }
        return;
      }
    }
  };

  const checkMulticlass = (cls: Class): void => {
    const qualifies = (c: Class): boolean => {
      const meets = (a: Ability): boolean => scoreValues[a] >= MULTICLASS_MINIMUM;
      return c.primaryAbilityMode === 'any' ? c.primaryAbilities.some(meets) : c.primaryAbilities.every(meets);
    };
    const current = [...classLevels.keys()].flatMap((id) => find(compendium.classes, id) ?? []);
    for (const c of [cls, ...current]) {
      if (!qualifies(c)) {
        const join = c.primaryAbilityMode === 'any' ? ' ou ' : ' e ';
        const need = c.primaryAbilities.map((a) => ABILITY_NAME[a]).join(join);
        error('prerequisite_not_met', `Multiclasse em ${cls.name} exige ${need} ${MULTICLASS_MINIMUM} (${c.name}).`);
      }
    }
  };

  character.steps.forEach((step, index) => {
    stepIndex = index;
    selections = step.selections;
    used = new Set<number>();
    applyStep(step);
    advanceLeveled();
    selections.forEach((s, i) => {
      if (!used.has(i)) {
        error('unexpected_selection', `Seleção sem escolha correspondente neste passo: ${s.source.kind}:${s.source.id} / ${s.choiceId}.`, s.choiceId);
      }
    });
  });

  // --- Verificações finais ---------------------------------------------------

  stepIndex = character.steps.length;
  const proficientSkills = new Set(
    effects.flatMap(({ effect }) => (effect.type === 'grant_proficiency' && effect.category === 'skill' && effect.level !== 'expertise' ? [effect.id] : [])),
  );
  for (const check of masteryChecks) {
    if (!isWeaponProficient(effects, check.weapon)) {
      issues.push({
        severity: 'error',
        code: 'invalid_selection',
        message: `Maestria em ${check.weapon.name} exige proficiência com a arma.`,
        stepIndex: check.stepIndex,
        choiceId: check.choiceId,
      });
    }
  }
  for (const check of expertiseChecks) {
    if (!proficientSkills.has(check.skill)) {
      issues.push({
        severity: 'error',
        code: 'invalid_selection',
        message: `Especialização em ${check.skill} exige proficiência nessa perícia.`,
        stepIndex: check.stepIndex,
        choiceId: check.choiceId,
      });
    }
  }
  if (!speciesId) issues.push({ severity: 'error', code: 'missing_step', message: 'Escolha uma espécie.' });
  if (!backgroundId) issues.push({ severity: 'error', code: 'missing_step', message: 'Escolha um antecedente.' });
  if (characterLevel === 0) issues.push({ severity: 'error', code: 'missing_step', message: 'Escolha uma classe.' });

  return {
    level: characterLevel,
    classes: [...classLevels.entries()].map(([classId, level]) => ({ classId, level, subclassId: subclasses.get(classId) })),
    levelOrder,
    speciesId,
    backgroundId,
    size,
    scores,
    effects,
    features,
    feats,
    classSpells,
    abilityChoices,
    pending,
    issues,
  };
}
