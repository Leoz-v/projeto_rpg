import type { Ability, Condition, CreatureType, DamageType } from '../schemas/common';
import type { BaseEffect, BonusValue, FeatureUse, FeatureUseExtension, FeatureUsePart } from '../schemas/effect';
import type { Inventory } from '../schemas/inventory';
import type { Item } from '../schemas/item';
import { effectiveConditions } from './conditions';
import { addFlat } from './spells';
import type { SourceLabel } from './types';

/**
 * Usar características (efeito `feature_use`; nota 0078): o que a ficha
 * permite, já com os números do personagem. Quem rola e aplica é o Host.
 */

type PartOf<K extends FeatureUsePart['kind']> = Extract<FeatureUsePart, { kind: K }>;

export type ResolvedFeaturePart =
  | { kind: 'heal'; dice: string; minimum: number; temporary: boolean }
  | PartOf<'pool_heal'>
  | PartOf<'pool_restore'>
  | PartOf<'restore'>
  | PartOf<'condition'>
  | PartOf<'regain'>
  | { kind: 'inspire'; dice: string }
  | {
      kind: 'save';
      ability: Ability;
      dc: number;
      damage?: { dice: string; type: DamageType | DamageType[]; exceptTypes?: CreatureType[] | undefined } | undefined;
      onSuccess: 'half' | 'none';
      conditions: Exclude<Condition, 'exhaustion'>[];
      endsOnDamage: boolean;
      onlyTypes?: CreatureType[] | undefined;
      until?: 'user_turn_start' | 'user_turn_end' | undefined;
      failNote?: string | undefined;
      successEffect?: 'stunning' | undefined;
    }
  | PartOf<'note'>
  | { kind: 'fail_damage'; dice: string; type: DamageType }
  | PartOf<'buff'>;

export interface SheetFeatureUse {
  id: string;
  name: string;
  /** "Ação Bônus", "Ação de Magia". */
  action?: string | undefined;
  cost?: { resourceId: string; amount: number } | undefined;
  targets: 'self' | 'one' | 'many';
  /** Com `many`: quantos alvos no máximo (Abjure Foes); ausente, os da área. */
  maxTargets?: number | undefined;
  duration?: string | undefined;
  forbidHeavyArmor: boolean;
  note?: string | undefined;
  /** Usada a partir de um ataque que acertou (nota 0083). */
  onHit?: { attacks: 'any' | 'unarmed' | 'monk'; oncePerTurn: boolean; rider?: string | undefined; afterUse?: string | undefined; group?: string | undefined } | undefined;
  parts: ResolvedFeaturePart[];
  source: SourceLabel;
}

interface Sourced<T> {
  effect: T;
  classId?: string | undefined;
  source: SourceLabel;
}

interface Numbers {
  bonus: (value: BonusValue, classId: string | undefined) => number;
  scaleLevel: (classId: string | undefined) => number;
  /** CD de magia da classe; `undefined` se ela não conjura. */
  spellDc: (classId: string | undefined) => number | undefined;
}

const atLevel = (dice: string | { byLevel: string[] }, level: number): string => (typeof dice === 'string' ? dice : (dice.byLevel[Math.max(1, level) - 1] ?? '0'));

/**
 * Os efeitos com os números de agora: ficam num ajuste, que não sabe de que
 * classe vieram.
 */
function concreteEffect(effect: BaseEffect, classId: string | undefined, numbers: Numbers): BaseEffect {
  if (effect.type === 'attack_rider') return { ...effect, dice: atLevel(effect.dice, numbers.scaleLevel(classId)) };
  if (effect.type === 'flat_bonus') return { ...effect, value: numbers.bonus(effect.value, classId) };
  return effect;
}

function resolvePart(part: FeatureUsePart, classId: string | undefined, numbers: Numbers): ResolvedFeaturePart {
  if (part.kind === 'heal') {
    const dice = atLevel(part.dice ?? '0', numbers.scaleLevel(classId));
    const bonus = part.bonus.reduce<number>((sum, b) => sum + numbers.bonus(b, classId), 0);
    return { kind: 'heal', dice: addFlat(dice, bonus), minimum: part.minimum ?? 0, temporary: part.temporary === true };
  }
  if (part.kind === 'save') {
    // CD de magia da classe, ou 8 + proficiência + atributo (Breath Weapon, Intimidating Presence).
    const base = 8 + numbers.bonus({ proficiency: 1 }, classId);
    const dc = part.dc === 'spell' ? (numbers.spellDc(classId) ?? base) : base + numbers.bonus({ ability: part.dc.ability }, classId);
    const damage = part.damage
      ? {
          dice: addFlat(atLevel(part.damage.dice, numbers.scaleLevel(classId)), part.damage.bonus.reduce<number>((sum, b) => sum + numbers.bonus(b, classId), 0)),
          type: part.damage.type,
          ...(part.damage.exceptTypes ? { exceptTypes: part.damage.exceptTypes } : {}),
        }
      : undefined;
    return {
      kind: 'save',
      ability: part.ability,
      dc,
      ...(damage ? { damage } : {}),
      onSuccess: part.onSuccess,
      conditions: part.conditions,
      endsOnDamage: part.endsOnDamage === true,
      ...(part.onlyTypes ? { onlyTypes: part.onlyTypes } : {}),
      ...(part.until !== undefined ? { until: part.until } : {}),
      ...(part.failNote !== undefined ? { failNote: part.failNote } : {}),
      ...(part.successEffect !== undefined ? { successEffect: part.successEffect } : {}),
    };
  }
  if (part.kind === 'fail_damage') {
    const count = numbers.bonus(part.count, classId);
    return { kind: 'fail_damage', dice: count > 0 ? `${count}d${part.sides}` : '0', type: part.type };
  }
  if (part.kind === 'inspire') return { kind: 'inspire', dice: atLevel(part.dice, numbers.scaleLevel(classId)) };
  if (part.kind === 'buff') return { ...part, effects: part.effects.map((e) => concreteEffect(e, classId, numbers)) };
  return part;
}

/** As características que o personagem pode usar; a de mesmo id que vem depois substitui, e as extensões somam partes. */
export function resolveFeatureUses(uses: readonly Sourced<FeatureUse>[], extensions: readonly Sourced<FeatureUseExtension>[], numbers: Numbers): SheetFeatureUse[] {
  const found = new Map<string, SheetFeatureUse>();
  for (const { effect, classId, source } of uses) {
    found.set(effect.id, {
      id: effect.id,
      name: effect.name,
      ...(effect.action !== undefined ? { action: effect.action } : {}),
      ...(effect.cost ? { cost: { resourceId: effect.cost.resource, amount: effect.cost.amount } } : {}),
      targets: effect.targets,
      ...(effect.maxTargets !== undefined ? { maxTargets: Math.max(1, numbers.bonus(effect.maxTargets, classId)) } : {}),
      ...(effect.duration !== undefined ? { duration: effect.duration } : {}),
      forbidHeavyArmor: effect.forbidHeavyArmor === true,
      ...(effect.note !== undefined ? { note: effect.note } : {}),
      ...(effect.onHit
        ? {
            onHit: {
              attacks: effect.onHit.attacks,
              oncePerTurn: effect.onHit.oncePerTurn === true,
              ...(effect.onHit.rider !== undefined ? { rider: effect.onHit.rider } : {}),
              ...(effect.onHit.afterUse !== undefined ? { afterUse: effect.onHit.afterUse } : {}),
              ...(effect.onHit.group !== undefined ? { group: effect.onHit.group } : {}),
            },
          }
        : {}),
      parts: effect.parts.map((p) => resolvePart(p, classId, numbers)),
      source,
    });
  }
  for (const { effect, classId } of extensions) {
    const use = found.get(effect.use);
    if (use) found.set(effect.use, { ...use, parts: [...use.parts, resolvePart(effect.part, classId, numbers)] });
  }
  return [...found.values()];
}

/** Arma de Monge (Martial Arts; nota 0083): corpo a corpo simples, ou marcial com a propriedade Light. */
export function isMonkWeapon(weapon: Pick<Item & { kind: 'weapon' }, 'category' | 'attackKind' | 'properties'>): boolean {
  return weapon.attackKind === 'melee' && (weapon.category === 'simple' || weapon.properties.includes('light'));
}

/** Usos que a característica tira de uma reserva à escolha (Lay On Hands). */
export const isPoolUse = (use: Pick<SheetFeatureUse, 'parts'>): boolean => use.parts.some((p) => p.kind === 'pool_heal' || p.kind === 'pool_restore');

/** As condições que a reserva termina, com o custo de cada uma. */
export function poolConditions(use: Pick<SheetFeatureUse, 'parts'>): { condition: Exclude<Condition, 'exhaustion'>; cost: number }[] {
  return use.parts.flatMap((p) => (p.kind === 'pool_restore' ? p.conditions.map((condition) => ({ condition, cost: p.cost })) : []));
}

/** Veste armadura pesada (Rage não entra nem continua). */
export function wearsHeavyArmor(inventory: Inventory, findItem: (id: string) => Item | undefined): boolean {
  return inventory.items.some((entry) => {
    if (!entry.equipped) return false;
    const item = findItem(entry.itemId);
    const baseId = item?.kind === 'magic_item' ? (entry.baseItemId ?? (item.base?.ids.length === 1 ? item.base.ids[0] : undefined)) : undefined;
    const physical = baseId !== undefined ? findItem(baseId) : item;
    return physical?.kind === 'armor' && physical.category === 'heavy';
  });
}

/** O estado acabou: uma condição que o encerra, armadura pesada ou a morte. */
export function featureEnded(
  endsOn: NonNullable<PartOf<'buff'>['endsOn']>,
  state: { conditions: readonly Condition[]; heavyArmor: boolean; dead: boolean },
): boolean {
  const conditions = effectiveConditions(state.conditions);
  return state.dead || endsOn.some((e) => (e === 'heavy_armor' ? state.heavyArmor : conditions.has(e)));
}
