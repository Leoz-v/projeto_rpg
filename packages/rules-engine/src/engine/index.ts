export * from './math';
export * from './types';
export { pruneSelections, resolveBuild, type ResolvedBuild, type SourcedEffect } from './build';
export { deriveSheet, evaluatePredicate, type PredicateContext, type RollContext, type SheetInput, TABLE_CONDITION_SOURCE, type TableConditions } from './sheet';
export { applyDamage, damageNotes, type AppliedDamage, type DamageInstance, type DamageResult, type DamageStep } from './damage';
export { type DiceRoll, type Rng, type RollDiceOptions, rollDice, seededRng } from './dice';
export { type D20RollInput, type D20RollResult, type D20Step, rollD20 } from './d20';
export { cellDistanceFeet, distanceFeet, FEET_PER_SQUARE, type Footprint, type GridCell, sizeAtMost, SPACE_FEET, spaceSquares } from './space';
export { baseItemOptions, inventoryEntryProblems } from './items';
export { ABILITY_ROLL_DICE, ABILITY_ROLL_SIDES, type AbilityRollSet, rollAbilityScores, usesRolledValues } from './ability-scores';
export { applyHitPointChange, clampHitPoints, currentHitPoints, type HitPointChange, isBloodied, type HitPointResult, type HitPointState } from './hit-points';
export { DEATH_SAVE_DC, type DeathDamageEvent, deathAfterDamage, deathAfterHealing, type DeathSaveOutcome, type DeathSaveState, isDying, NO_DEATH_SAVES, resolveDeathSave } from './death';
export { concentrationDc } from './concentration';
export { addDice, addFlat, cantripTier, multiplyDice, type ResolvedSpellDamage, type ResolvedSpellPart, resolveSpellParts, type SpellCastOptions, spellDamageWith } from './spells';
export { availableHitDice, exhaustionAfterLongRest, type HitDiceSpent, hitDieHealing, MIN_HP_TO_REST } from './rest';
export { availableSpellSlots, NO_SPELL_SLOTS_SPENT, type SlotPool, type SpellSlotsSpent, spellSlotsAfterRest } from './spell-slots';
export { availableUses, type ResourceRechargeRule, type ResourcesSpent, resourcesAfterRest } from './resources';
export {
  d20StepNotes,
  type DamageGroup,
  type DamageOptions,
  type DeclaredRoll,
  d20Mode,
  matchesAgainst,
  type RollAgainst,
  rollReminders,
  rollWeaponDamage,
  type SheetD20,
  sheetD20,
  type SheetRollTarget,
  spellAttackD20,
  type WeaponDamageRoll,
} from './sheet-roll';
export {
  type AttackInput,
  type AttackResult,
  creatureDefenses,
  creatureSaveBonus,
  criticalDice,
  resolveAttack,
  resolveSave,
  rollActionDamage,
  type SaveInput,
  type SaveResult,
} from './attack';
export {
  cleaveDamageBonus,
  grazeDamage,
  MASTERY_ACTIONS,
  MASTERY_NAME,
  type MasteryAction,
  type MasteryContext,
  type MasteryOutcome,
  masteryOutcome,
  SLOW_SPEED_PENALTY,
  TIMED_MASTERIES,
  TIMED_MASTERY_UNTIL,
  type TimedMastery,
  timedMastery,
  timedMasteryNote,
  TOPPLE_DC_BASE,
  toppleDc,
} from './mastery';
export { expiresAt, type InitiativeOrder, nextTurn, nextTurnRound, previousTurn, sortByInitiative, type TurnEdge, type TurnExpiry, type TurnPosition, turnAfterRemoval } from './combat';
export {
  type AttackedConditionEffects,
  attackedConditions,
  CLOSE_RANGE_FT,
  type ConditionRoll,
  type ConditionRollEffects,
  conditionDefenses,
  conditionSource,
  creatureD20,
  type CreatureD20,
  effectiveConditions,
  ownRollConditions,
  SPEED_ZERO_CONDITIONS,
  withoutDependents,
} from './conditions';
export { attackedByEffects, creatureAc, creatureAttacksAgainst, creatureReminders, creatureRollEffects, hasUnsupportedCreatureEffect, type NamedEffects, withEffectDefenses } from './creature-effects';
export { type TargetDamage, targetDamage } from './target-damage';
export { availableMonsterUses, type LimitedFeature, monsterSpellUseId, monsterUseMax, type MonsterUseLimit, pendingRecharges, RECHARGE_DIE, withMonsterUse } from './monster-uses';
export { multiattackFits, type MultiattackSlot, multiattackSlots } from './multiattack';
export { type MonsterSpell, monsterSpells } from './monster-spells';
export { CONDITION_NAME, DAMAGE_NAME } from './names';
