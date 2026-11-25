import type { AttackRider } from './attack-riders';
import type { SheetFeatureUse } from './feature-uses';
import type { Ability, CreatureType, DamageType, Condition, Sense, Size, Skill, WeaponMastery } from '../schemas/common';
import type { Predicate } from '../schemas/predicate';
import type { ChoiceOptions, Feature } from '../schemas/source';
import type { SourceKindSchema } from '../schemas/character';
import type { ResourceRecharge, SpellUsesSchema, TriggerMoment } from '../schemas/effect';
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

/** Regra de Teste d20 já resolvida (`d20_rule`, docs/effects-spec.md 3.17): `minimum_total` com o valor do atributo calculado. */
export type D20Rule =
  | { rule: 'reroll'; on: number }
  | { rule: 'minimum_die'; value: number }
  | { rule: 'minimum_total'; value: number }
  | { rule: 'auto_success' }
  | { rule: 'count_as_20'; min: number };

export type SourcedD20Rule = D20Rule & { source: SourceLabel };

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
  /** Regras `d20_rule` que valem nesta rolagem (Halfling Luck, Reliable Talent), aplicadas por `rollD20`. */
  rules: SourcedD20Rule[];
  /** Falha automática contra a CD (condições: Paralisado em salvaguarda de FOR/DES). */
  autoFail: SourceLabel[];
  /** Regras com `when` que depende do contexto da rolagem (Greater Magic Resistance, contra magia): lembrete. */
  situationalRules: (SourcedD20Rule & { when?: Predicate | undefined; note?: string | undefined })[];
  /** Dados somados ou subtraídos (`d20_bonus`: Bless, Guidance), rolados a cada rolagem. */
  bonusDice: BonusDie[];
  /** Os de `when` desconhecido ou com `note`: lembrete, ou valem quando a rolagem confirma o contexto. */
  situationalBonusDice: (BonusDie & { when?: Predicate | undefined; note?: string | undefined })[];
}

/** Um dado somado ao Teste d20 (`d20_bonus`), com a fonte. */
export interface BonusDie {
  dice: string;
  subtract: boolean;
  source: SourceLabel;
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
  /** `dieMinimum`: cada dado de dano abaixo disto vale isto (Great Weapon Fighting). */
  damage: { dice: string; bonus: Stat; type: DamageType; dieMinimum?: { value: number; source: SourceLabel } | undefined };
  /** Dano extra ao acertar (Radiant Strikes, Vicious Weapon), com a fonte. */
  extraDamage: { dice: string; type: DamageType; source: SourceLabel }[];
  /** Dano extra que depende do alvo, do d20 ou de escolha (nota 0077). */
  riders: AttackRider[];
  /** Menor resultado do d20 que faz Acerto Crítico (20 sem efeitos `crit_range`). */
  critRange: number;
  /** Dano com duas mãos (propriedade Versatile). */
  versatileDice?: string | undefined;
  /** Mínimo por dado de dano no uso com duas mãos da arma Versatile. */
  versatileDieMinimum?: { value: number; source: SourceLabel } | undefined;
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
  /** Magias do personagem que exigem Concentração (nota 0045). */
  concentration: string[];
  /** Magias cuja Concentração o dano não quebra (`keep_concentration`). */
  keepConcentration: string[];
  /** Magias que o personagem pode conjurar e como (nota 0053). */
  castable: CastableSpell[];
  /** Vantagem, Desvantagem e regras do d20 dos ataques de magia; o bônus vem de quem conjura (nota 0055). */
  attackRoll: RollState;
}

/** De onde vem a magia conjurável: o atributo, a CD e o bônus de ataque (classe ou magia concedida). */
export interface SpellCaster {
  ability: Ability;
  saveDc: number;
  attack: Stat;
}

/** Uma magia conjurável: o círculo (0 = truque), as tags e as formas de conjurar. */
export interface CastableSpell {
  spellId: string;
  level: number;
  ritual: boolean;
  concentration: boolean;
  /** Pode usar um espaço de magia (magia de classe, ou concedida que aceita espaços). */
  slots: boolean;
  /** Sem espaço: truque, concedida à vontade, ou concedida com usos por descanso (o recurso que ela gasta). */
  free?: 'cantrip' | 'at_will' | { resourceId: string } | undefined;
  /** Atributos com que pode ser conjurada (uma magia pode vir de duas classes), sem repetir; a de maior CD primeiro. */
  casters: SpellCaster[];
}

/** Classe em que o personagem pode ganhar o próximo nível. `problems` vazio = pode. */
export interface LevelUpOption {
  classId: string;
  /** Primeiro nível nesta classe (multiclasse: confere os atributos mínimos). */
  multiclass: boolean;
  problems: string[];
}

/** Uma entrada do inventário como a ficha mostra. */
export interface InventoryLine {
  instanceId: string;
  itemId: string;
  /** Nome exibido: variante e item base ("Weapon, +1 (Longsword)"), ou o nome do item. */
  name: string;
  /** Tipo do item físico (o item base, num item mágico genérico); ausente se a entrada é inválida. */
  kind?: 'weapon' | 'armor' | 'tool' | 'gear' | 'magic_item' | undefined;
  quantity: number;
  equipped: boolean;
  attuned: boolean;
  /** O item exige sintonização para funcionar. */
  requiresAttunement: boolean;
  /** Os efeitos do item valem agora (vestido, sintonizado ou só carregado, conforme o item). */
  active: boolean;
  /** O item pode ser usado (nota 0074): quantos alvos e as opções à escolha. */
  use?: { targets: 'one' | 'many'; options: string[] } | undefined;
  /** A magia do pergaminho (nota 0076); `null` se a entrada não tem magia. `problem`: por que não dá para ler. `checkDc`: o teste exigido. */
  scroll?: { spell: string | null; problem?: string | undefined; checkDc?: number | undefined } | undefined;
  /** Cargas desta cópia e as magias que elas conjuram (nota 0075). */
  charges?:
    | {
        max: number;
        available: number;
        /** Dados recuperados ao amanhecer. */
        regain?: string | undefined;
        spells: { spellId: string; name: string; level: number; note?: string | undefined; costs: { charges: number; level: number }[] }[];
      }
    | undefined;
}

export interface PendingChoice {
  stepIndex: number;
  source: SourceLabel;
  choiceId: string;
  count: number;
  options: ChoiceOptions;
  /**
   * Ids que podem ser escolhidos, já filtrados pela categoria, pela lista,
   * pelos pré-requisitos e pelo que o personagem já tem. O motor valida a
   * seleção de novo ao aplicá-la.
   */
  candidates: string[];
  /** Um id pode aparecer mais de uma vez nos picks (`ability_score`: repetir = +2). */
  repeatable: boolean;
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
  | 'invalid_item'
  | 'attunement_restricted'
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
  /** Reduções roladas a cada dano do tipo (Ring of Warmth), aplicadas por `applyDamage`. */
  damageReductions: { damageType: DamageType; amount: string; source: SourceLabel }[];
  resistances: { damageType: DamageType; sources: SourceLabel[] }[];
  vulnerabilities: { damageType: DamageType; sources: SourceLabel[] }[];
  damageImmunities: { damageType: DamageType; sources: SourceLabel[] }[];
  conditionImmunities: { condition: Condition; sources: SourceLabel[] }[];
}

/** Vantagem ou Desvantagem de quem ataca a criatura (`attacks_against`; nota 0062). */
export interface AttacksAgainst {
  mode: 'advantage' | 'disadvantage';
  from?: readonly CreatureType[] | undefined;
  note?: string | undefined;
  source: SourceLabel;
}

export interface DerivedSheet {
  /** Sem escolhas pendentes nem erros. */
  complete: boolean;
  pending: PendingChoice[];
  issues: Issue[];
  /** Opções do próximo nível (todas as classes do compêndio); vazio sem classe ou no nível 20. */
  levelUp: LevelUpOption[];
  inventory: InventoryLine[];
  /** Itens sintonizados e o limite (3 mais efeitos `attunement_slots`). */
  attunement: { used: number; limit: number };

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
  /** Salvaguarda contra a Morte: sem atributo; recebe `save.all` e `death_save`. */
  deathSave: RollStat;
  speed: { walk: Stat; fly: Stat; swim: Stat; climb: Stat; burrow: Stat };
  saves: Record<Ability, SaveStat>;
  skills: Record<Skill, SkillStat>;
  /** Testes de atributo sem perícia. */
  checks: Record<Ability, RollStat>;
  senses: { sense: Sense; range: number; source: SourceLabel }[];
  defenses: Defenses;
  attacksAgainst: AttacksAgainst[];
  proficiencies: {
    armor: string[];
    weapons: string[];
    tools: { id: string; level: ProficiencyLevel }[];
    languages: string[];
  };
  weaponMasteries: string[];
  attacks: WeaponAttack[];
  spellcasting: Spellcasting;
  /** Características que se usam na mesa (nota 0078). */
  featureUses: SheetFeatureUse[];
  feats: { featId: string; source: SourceLabel }[];
  features: SheetFeature[];
  conditions: { condition: Condition; source: SourceLabel }[];
  exhaustion: number;  /** Lembretes e curas que o Host aplica nos momentos do combate (`reminder`, `turn_start_heal`; nota 0043). */
  triggers: SheetTrigger[];
  /** Recursos de uso limitado, já com o máximo (efeito `resource`; nota 0052). */
  resources: SheetResource[];
}

export interface SheetResource {
  id: string;
  name: string;
  max: number;
  recharge: ResourceRecharge;
  source: SourceLabel;
}

/** Efeito de um momento do combate, como a ficha o resolve. */
export type SheetTrigger =
  | { kind: 'reminder'; on: TriggerMoment; text: string; source: SourceLabel }
  /** Cura no início do turno, já com o modificador (mínimo 0). */
  | { kind: 'heal'; on: 'turn_start'; amount: number; bloodiedOnly: boolean; source: SourceLabel };
