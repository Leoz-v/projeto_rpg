import { z } from 'zod';
import { ArmorCategorySchema, AttackKindSchema, ConditionSchema, WeaponPropertySchema } from './common';

/**
 * Predicados `when` (docs/effects-spec.md, seção 2). Lista fechada: cada
 * predicado é um objeto com exatamente uma chave.
 */
export type Predicate =
  | { wearingArmor: boolean }
  | { armorCategory: z.infer<typeof ArmorCategorySchema> }
  | { wieldingShield: boolean }
  | { attackKind: z.infer<typeof AttackKindSchema> }
  | { weaponProperty: z.infer<typeof WeaponPropertySchema> }
  /** A rolagem é para evitar ou encerrar a condição. */
  | { against: { condition: z.infer<typeof ConditionSchema> } }
  /** A rolagem é contra uma magia (`spell`) ou contra magia ou outro efeito mágico (`magic`). */
  | { against: { source: 'spell' | 'magic' } }
  /** A arma usada é da categoria. */
  | { weaponCategory: 'simple' | 'martial' }
  /** A criatura está com a condição. */
  | { hasCondition: z.infer<typeof ConditionSchema> }
  | { not: Predicate }
  | { all: Predicate[] }
  | { any: Predicate[] };

export const PredicateSchema: z.ZodType<Predicate> = z.lazy(() =>
  z.union([
    z.strictObject({ wearingArmor: z.boolean() }),
    z.strictObject({ armorCategory: ArmorCategorySchema }),
    z.strictObject({ wieldingShield: z.boolean() }),
    z.strictObject({ attackKind: AttackKindSchema }),
    z.strictObject({ weaponProperty: WeaponPropertySchema }),
    z.strictObject({ against: z.strictObject({ condition: ConditionSchema }) }),
    z.strictObject({ against: z.strictObject({ source: z.enum(['spell', 'magic']) }) }),
    z.strictObject({ weaponCategory: z.enum(['simple', 'martial']) }),
    z.strictObject({ hasCondition: ConditionSchema }),
    z.strictObject({ not: PredicateSchema }),
    z.strictObject({ all: z.array(PredicateSchema).min(1) }),
    z.strictObject({ any: z.array(PredicateSchema).min(1) }),
  ]),
);
