import type { Ability, DamageType, Condition, Sense, Size, Skill, WeaponMastery } from '../schemas/common';
import type { Predicate } from '../schemas/predicate';
import type { ChoiceOptions, Feature } from '../schemas/source';
import type { SourceKindSchema } from '../schemas/character';
import type { SpellUsesSchema } from '../schemas/effect';
import type { z } from 'zod';

/** De onde veio um valor: fonte de construção, item, ajuste do mestre ou regra do motor. */
export interface SourceLabel {
  kind: z.infer<typeof SourceKindSchema> | 'item' | 'adjustment' | 'rule';
  id: string;
  name: string;
}

/** Uma parcela de um número da ficha, com rótulo para a UI ("Modificador de FOR", "Anel de Proteção"). */
export interface Contribution {
  label: string;
  value: number;
  source?: SourceLabel | undefined;
}

/** Número calculado e a conta completa. */
export interface Stat {
  total: number;
  parts: Contribution[];
}

export type RollMode = 'normal' | 'advantage' | 'disadvantage';

/** Estado de vantagem/desvantagem de uma rolagem (regra 2024: uma de cada se anulam). */
export interface RollState {
  mode: RollMode;
  advantage: SourceLabel[];
  disadvantage: SourceLabel[];
  /**
   * Vale só em certas rolagens: `when` depende do contexto (ex.: `against` uma
   * condição) ou o efeito tem `note`. A UI mostra o lembrete; na Fase 4 o
   * motor avalia `when` na rolagem concreta.
   */
  situational: { kind: 'advantage' | 'disadvantage'; source: SourceLabel; when?: Predicate | undefined; note?: string | undefined }[];
}

export interface RollStat extends Stat {
  roll: RollState;
}

export type ProficiencyLevel = 'none' | 'proficient' | 'expertise';

export interface SkillStat extends RollStat {
  ability: Ability;
  proficiency: ProficiencyLevel;
  passive: Stat;
}

export interface SaveStat extends RollStat {
  proficient: boolean;
}

export interface AbilityStat extends Stat {
  modifier: number;
}

export interface WeaponAttack {
  itemId: string;
  instanceId: string;
  name: string;
  kind: 'melee' | 'ranged';
  ability: Ability;
  proficient: boolean;
  attack: RollStat;
  damage: { dice: string; bonus: Stat; type: DamageType };
  /** Dano com duas mãos (propriedade Versatile). */
  versatileDice?: string | undefined;
  range?: { normal: number; long: number } | undefined;
  reach: number;
  mastery: { property: WeaponMastery; available: boolean };
}

export interface GrantedSpell {
  spellId: string;
  ability: Ability;
  uses: z.infer<typeof SpellUsesSchema>;
  /** Usos sem espaço de magia já resolvidos (proficiência, tabela por nível); ausente para `at_will`/`slot`. */
  count?: number | undefined;
  saveDc: number;
  attackBonus: number;
  source: SourceLabel;
}

export interface ClassSpellcasting {
  classId: string;
  ability: Ability;
  saveDc: Stat;
  attack: Stat;
  /** Quantidade de magias preparadas pelo nível da classe. */
  preparedSpells: number;
  cantrips: string[];
  /** Magias de nível 1+ conhecidas (no grimório, para o Mago). */
  spells: string[];
}

export interface Spellcasting {
  classes: ClassSpellcasting[];
  /** Espaços por nível de magia (índice 0 = nível 1), somando as classes conjuradoras. */
  slots: number[];
  /** Espaços da Magia de Pacto (Bruxo), separados dos demais. */
  pactSlots?: { count: number; level: number } | undefined;
  granted: GrantedSpell[];
  /** Falso vestindo armadura sem treinamento. */
  canCast: boolean;
}

export interface PendingChoice {
  stepIndex: number;
  source: SourceLabel;
  choiceId: string;
  count: number;
  options: ChoiceOptions;
}

export type IssueCode =
  | 'missing_step'
  | 'unknown_reference'
  | 'invalid_selection'
  | 'unexpected_selection'
  | 'prerequisite_not_met'
  | 'duplicate_feat'
  | 'size_required'
  | 'multiple_armor'
  | 'too_many_attuned'
  | 'armor_untrained'
  | 'shield_untrained'
  | 'not_supported';

export interface Issue {
  severity: 'error' | 'warning';
  code: IssueCode;
  /** Texto em pt-BR para a UI. */
  message: string;
  stepIndex?: number | undefined;
  choiceId?: string | undefined;
}

export interface SheetFeature {
  feature: Feature;
  source: SourceLabel;
}

export interface Defenses {
  resistances: { damageType: DamageType; sources: SourceLabel[] }[];
  vulnerabilities: { damageType: DamageType; sources: SourceLabel[] }[];
  damageImmunities: { damageType: DamageType; sources: SourceLabel[] }[];
  conditionImmunities: { condition: Condition; sources: SourceLabel[] }[];
}

export interface DerivedSheet {
  /** Sem escolhas pendentes nem erros. */
  complete: boolean;
  pending: PendingChoice[];
  issues: Issue[];

  level: number;
  classes: { classId: string; level: number; subclassId?: string | undefined }[];
  speciesId?: string | undefined;
  backgroundId?: string | undefined;
  size?: Size | undefined;
  proficiencyBonus: number;

  abilities: Record<Ability, AbilityStat>;
  hpMax: Stat;
  hitDice: { die: number; count: number }[];
  ac: Stat;
  initiative: RollStat;
  speed: { walk: Stat; fly: Stat; swim: Stat; climb: Stat; burrow: Stat };
  saves: Record<Ability, SaveStat>;
  skills: Record<Skill, SkillStat>;
  senses: { sense: Sense; range: number; source: SourceLabel }[];
  defenses: Defenses;
  proficiencies: {
    armor: string[];
    weapons: string[];
    tools: { id: string; level: ProficiencyLevel }[];
    languages: string[];
  };
  weaponMasteries: string[];
  attacks: WeaponAttack[];
  spellcasting: Spellcasting;
  feats: { featId: string; source: SourceLabel }[];
  features: SheetFeature[];
  conditions: { condition: Condition; source: SourceLabel }[];
  exhaustion: number;
}
