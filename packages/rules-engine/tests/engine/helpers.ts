import { type CharacterInput, CharacterSchema, GmAdjustmentSchema } from '../../src/schemas/character';
import { type InventoryInput, InventorySchema } from '../../src/schemas/inventory';
import { type ItemInput, ItemSchema } from '../../src/schemas/item';
import { deriveSheet } from '../../src/engine/sheet';
import type { DerivedSheet } from '../../src/engine/types';
import { type Compendium, loadSrdCompendium } from '../../src/srd';

/** Seleção curta: `sel('class', 'fighter', 'skills', 'athletics', 'perception')`. */
export function sel(kind: 'species' | 'background' | 'class' | 'subclass' | 'feat' | 'creation', id: string, choiceId: string, ...picks: string[]) {
  return { source: { kind, id }, choiceId, picks };
}

export const LANGUAGES = sel('creation', 'character', 'languages', 'dwarvish', 'elvish');

/** Guerreiro anão de nível 1 completo, base para variar nos testes. */
export function fighterSteps(extra: CharacterInput['steps'] = []): CharacterInput['steps'] {
  return [
    { kind: 'species', speciesId: 'dwarf', selections: [LANGUAGES] },
    { kind: 'background', backgroundId: 'soldier', abilityIncreases: { str: 2, con: 1 }, selections: [sel('background', 'soldier', 'gaming_set', 'gaming_set_dice')] },
    {
      kind: 'class_level',
      classId: 'fighter',
      selections: [
        sel('class', 'fighter', 'skills', 'perception', 'survival'),
        sel('class', 'fighter', 'fighting_style', 'defense'),
        sel('class', 'fighter', 'weapon_mastery_1', 'longsword', 'greatsword', 'handaxe'),
      ],
    },
    ...extra,
  ];
}

export const STANDARD = { method: 'standard_array' as const, scores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 } };

/** Compêndio do SRD com itens extras (homebrew de teste). */
export function compendiumWith(items: ItemInput[] = []): Compendium {
  const srd = loadSrdCompendium();
  return { ...srd, items: [...srd.items, ...items.map((i) => ItemSchema.parse(i))] };
}

export function derive(options: {
  steps?: CharacterInput['steps'];
  baseScores?: CharacterInput['baseScores'];
  inventory?: InventoryInput;
  adjustments?: unknown[];
  compendium?: Compendium;
}): DerivedSheet {
  return deriveSheet({
    character: CharacterSchema.parse({ id: 'test', name: 'Teste', baseScores: options.baseScores ?? STANDARD, steps: options.steps ?? fighterSteps() }),
    inventory: InventorySchema.parse(options.inventory ?? {}),
    adjustments: (options.adjustments ?? []).map((a) => GmAdjustmentSchema.parse(a)),
    compendium: options.compendium ?? loadSrdCompendium(),
  });
}

export const errorsOf = (sheet: DerivedSheet): string[] => sheet.issues.filter((i) => i.severity === 'error').map((i) => i.code);
