import type { Condition } from '../schemas/common';
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
  | PartOf<'buff'>;

export interface SheetFeatureUse {
  id: string;
  name: string;
  /** "Ação Bônus", "Ação de Magia". */
  action?: string | undefined;
  cost?: { resourceId: string; amount: number } | undefined;
  targets: 'self' | 'one';
  duration?: string | undefined;
  forbidHeavyArmor: boolean;
  note?: string | undefined;
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
      ...(effect.duration !== undefined ? { duration: effect.duration } : {}),
      forbidHeavyArmor: effect.forbidHeavyArmor === true,
      ...(effect.note !== undefined ? { note: effect.note } : {}),
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
