import { z } from 'zod';
import { ArmorCategorySchema, AttackKindSchema, WeaponPropertySchema } from './common';

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
  | { all: Predicate[] }
  | { any: Predicate[] };

export const PredicateSchema: z.ZodType<Predicate> = z.lazy(() =>
  z.union([
    z.strictObject({ wearingArmor: z.boolean() }),
    z.strictObject({ armorCategory: ArmorCategorySchema }),
    z.strictObject({ wieldingShield: z.boolean() }),
    z.strictObject({ attackKind: AttackKindSchema }),
    z.strictObject({ weaponProperty: WeaponPropertySchema }),
    z.strictObject({ all: z.array(PredicateSchema).min(1) }),
    z.strictObject({ any: z.array(PredicateSchema).min(1) }),
  ]),
);
