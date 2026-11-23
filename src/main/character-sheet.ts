import { type Character, type Compendium, deriveSheet, type DerivedSheet, InventorySchema } from 'rules-engine';
import type { CharacterSheetView } from '../shared/ipc';
import type { SessionCharacter } from '../shared/protocol';

/**
 * Ficha de um personagem da mesa para a tela. O processo main só orquestra:
 * monta a entrada do motor a partir das escolhas que estão no estado da
 * sessão e devolve a ficha calculada, com os nomes do compêndio que a tela
 * precisa exibir (o pacote da tela não carrega o compêndio, nota 0022).
 * Como o cálculo é determinístico, Host e jogadores chegam à mesma ficha.
 */

/** Id usado na entrada do motor: os ids da sessão são UUID e o motor usa snake_case. */
const ENGINE_CHARACTER_ID = 'character';
/** Inventário e ajustes do mestre entram na sessão num PR seguinte da Fase 3. */
const EMPTY_INVENTORY = InventorySchema.parse({});

/** Nome de cada entrada do compêndio por id. Ids se repetem entre tipos só com o mesmo nome. */
function nameIndex(compendium: Compendium): Map<string, string> {
  const index = new Map<string, string>();
  const groups = [compendium.items, compendium.species, compendium.backgrounds, compendium.feats, compendium.classes, compendium.subclasses, compendium.spells];
  for (const group of groups) for (const entry of group) if (!index.has(entry.id)) index.set(entry.id, entry.name);
  return index;
}

const indexes = new WeakMap<Compendium, Map<string, string>>();

/** Ids do compêndio que a ficha cita sem nome. */
function referencedIds(sheet: DerivedSheet): string[] {
  const ids: (string | undefined)[] = [sheet.speciesId, sheet.backgroundId];
  for (const c of sheet.classes) ids.push(c.classId, c.subclassId);
  for (const t of sheet.proficiencies.tools) ids.push(t.id);
  for (const c of sheet.spellcasting.classes) ids.push(c.classId, ...c.cantrips, ...c.spells);
  for (const g of sheet.spellcasting.granted) ids.push(g.spellId);
  ids.push(...sheet.weaponMasteries);
  return ids.filter((id): id is string => id !== undefined);
}

export function characterSheet(record: SessionCharacter, compendium: Compendium): CharacterSheetView {
  if (record.baseScores === null) return { sheet: null, names: {} };
  const character: Character = { id: ENGINE_CHARACTER_ID, name: record.name, baseScores: record.baseScores, steps: record.steps };
  const sheet = deriveSheet({ character, inventory: EMPTY_INVENTORY, adjustments: [], compendium });
  let index = indexes.get(compendium);
  if (!index) {
    index = nameIndex(compendium);
    indexes.set(compendium, index);
  }
  const names: Record<string, string> = {};
  for (const id of referencedIds(sheet)) {
    const name = index.get(id);
    if (name !== undefined) names[id] = name;
  }
  return { sheet, names };
}
