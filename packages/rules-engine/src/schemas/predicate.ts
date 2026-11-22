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
    z.strictObject({ all: z.array(PredicateSchema).min(1) }),
    z.strictObject({ any: z.array(PredicateSchema).min(1) }),
  ]),
);
