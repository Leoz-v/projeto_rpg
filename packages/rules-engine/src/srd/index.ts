import { z } from 'zod';
import { CreatureSchema, type Creature } from '../schemas/creature';
import { ItemSchema, type Item } from '../schemas/item';
import { SpellSchema, type Spell } from '../schemas/spell';
import {
  BackgroundSchema,
  CharacterCreationSchema,
  ClassSchema,
  FeatSchema,
  SpeciesSchema,
  SubclassSchema,
  type Background,
  type CharacterCreation,
  type Class,
  type Feat,
  type Species,
  type Subclass,
} from '../schemas/source';
import armor from './data/armor.json';
import backgrounds from './data/backgrounds.json';
import classes from './data/classes.json';
import creation from './data/creation.json';
import feats from './data/feats.json';
import gear from './data/gear.json';
import monsters from './data/monsters.json';
import species from './data/species.json';
import spells from './data/spells.json';
import subclasses from './data/subclasses.json';
import tools from './data/tools.json';
import weapons from './data/weapons.json';

/**
 * Compêndio do SRD 5.2.1 embutido no app. Os dados em `./data` foram
 * transcritos de `srd-source/SRD_CC_v5.2.1.pdf` (ver o README da pasta) e são
 * validados pelos schemas ao carregar.
 */

export const SRD_VERSION = '5.2.1';

/** Atribuição exigida pela CC-BY 4.0, exibida na tela "Sobre" (texto fixado pela Wizards). */
export const SRD_ATTRIBUTION =
  'This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, ' +
  'available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 ' +
  'International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.';

export interface Compendium {
  items: Item[];
  species: Species[];
  backgrounds: Background[];
  feats: Feat[];
  classes: Class[];
  subclasses: Subclass[];
  spells: Spell[];
  /** Blocos de estatística (Monsters A–Z e Animals). */
  creatures: Creature[];
  creation: CharacterCreation;
}

const CompendiumSchema = z.strictObject({
  items: z.array(ItemSchema),
  species: z.array(SpeciesSchema),
  backgrounds: z.array(BackgroundSchema),
  feats: z.array(FeatSchema),
  classes: z.array(ClassSchema),
  subclasses: z.array(SubclassSchema),
  spells: z.array(SpellSchema),
  creatures: z.array(CreatureSchema),
  creation: CharacterCreationSchema,
});

/** Dados brutos, antes da validação (exportados para os testes de integridade). */
export const SRD_RAW = {
  items: [...weapons, ...armor, ...tools, ...gear],
  species,
  backgrounds,
  feats,
  classes,
  subclasses,
  spells,
  creatures: monsters,
  creation,
} as const;

let cache: Compendium | undefined;

/** Valida e devolve o compêndio do SRD. Lança erro se algum dado embutido for inválido. */
export function loadSrdCompendium(): Compendium {
  cache ??= CompendiumSchema.parse(SRD_RAW);
  return cache;
}
