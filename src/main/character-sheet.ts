import { type Character, type Compendium, deriveSheet, type DerivedSheet, type Grant, type LevelGrants } from 'rules-engine';
import type { CharacterSheetView, CreationOptions } from '../shared/ipc';
import type { SessionCharacter } from '../shared/protocol';

/**
 * Ficha de um personagem da mesa para a tela. O processo main só orquestra:
 * monta a entrada do motor a partir das escolhas que estão no estado da
 * sessão e devolve a ficha calculada, com os nomes e descrições do compêndio
 * que a tela precisa exibir (o pacote da tela não carrega o compêndio, nota 0022).
 * Como o cálculo é determinístico, Host e jogadores chegam à mesma ficha.
 */

/** Id usado na entrada do motor: os ids da sessão são UUID e o motor usa snake_case. */
const ENGINE_CHARACTER_ID = 'character';

interface Index {
  names: Map<string, string>;
  /** Texto para ajudar a escolher (talentos, magias, subclasses). */
  details: Map<string, string>;
}

const features = (grants: readonly Grant[]): string[] =>
  grants.flatMap((g) => (g.kind === 'feature' ? [`${g.feature.name}: ${g.feature.description}`] : []));
const featureNames = (levels: LevelGrants): string[] =>
  levels.flatMap((l) => l.grants.flatMap((g) => (g.kind === 'feature' ? [`${g.feature.name} (nível ${l.level})`] : [])));

const SPELL_LEVEL = (level: number): string => (level === 0 ? 'Truque' : `Nível ${level}`);

function buildIndex(compendium: Compendium): Index {
  const names = new Map<string, string>();
  const groups = [compendium.items, compendium.species, compendium.backgrounds, compendium.feats, compendium.classes, compendium.subclasses, compendium.spells];
  for (const group of groups) for (const entry of group) if (!names.has(entry.id)) names.set(entry.id, entry.name);

  // Opções nomeadas de escolhas (linhagens, invocações, estilos), em qualquer profundidade.
  const visit = (grants: readonly Grant[]): void => {
    for (const g of grants) {
      if (g.kind !== 'choice' || g.options.pick !== 'option') continue;
      for (const o of g.options.options) {
        if (!names.has(o.id)) names.set(o.id, o.name);
        visit(o.grants);
        for (const l of o.levels) visit(l.grants);
      }
    }
  };
  const levelled = [...compendium.species, ...compendium.backgrounds, ...compendium.classes, ...compendium.subclasses];
  for (const source of levelled) for (const l of source.levels) visit(l.grants);
  for (const c of compendium.classes) visit([...c.startingGrants, ...c.multiclassGrants]);
  for (const f of compendium.feats) visit(f.grants);
  visit(compendium.creation.grants);

  const details = new Map<string, string>();
  for (const feat of compendium.feats) details.set(`feat:${feat.id}`, [feat.description, ...features(feat.grants)].filter(Boolean).join('\n\n'));
  for (const spell of compendium.spells) {
    const tags = [spell.concentration ? 'concentração' : '', spell.ritual ? 'ritual' : ''].filter(Boolean).join(', ');
    details.set(`spell:${spell.id}`, `${SPELL_LEVEL(spell.level)} · ${spell.school}${tags ? ` (${tags})` : ''}\n${spell.castingTime} · ${spell.range} · ${spell.duration}\n\n${spell.description}`);
  }
  for (const sub of compendium.subclasses) details.set(`subclass:${sub.id}`, [sub.description, featureNames(sub.levels).join('\n')].filter(Boolean).join('\n\n'));
  return { names, details };
}

const indexes = new WeakMap<Compendium, Index>();

function indexOf(compendium: Compendium): Index {
  let index = indexes.get(compendium);
  if (!index) {
    index = buildIndex(compendium);
    indexes.set(compendium, index);
  }
  return index;
}

/** Ids do compêndio que a ficha cita sem nome. */
function referencedIds(sheet: DerivedSheet): string[] {
  const ids: (string | undefined)[] = [sheet.speciesId, sheet.backgroundId];
  for (const c of sheet.classes) ids.push(c.classId, c.subclassId);
  for (const t of sheet.proficiencies.tools) ids.push(t.id);
  for (const c of sheet.spellcasting.classes) ids.push(c.classId, ...c.cantrips, ...c.spells);
  for (const g of sheet.spellcasting.granted) ids.push(g.spellId);
  ids.push(...sheet.weaponMasteries);
  for (const p of sheet.pending) if (p.options.pick !== 'option') ids.push(...p.candidates);
  return ids.filter((id): id is string => id !== undefined);
}

/** Chave de `details` para os candidatos de uma escolha: talentos, magias e subclasses. */
const DETAIL_KIND = { feat: 'feat', spell: 'spell', subclass: 'subclass' } as const;

export function characterSheet(record: SessionCharacter, compendium: Compendium): CharacterSheetView {
  if (record.baseScores === null) return { sheet: null, names: {}, details: {} };
  const character: Character = { id: ENGINE_CHARACTER_ID, name: record.name, baseScores: record.baseScores, steps: record.steps };
  // Ajustes do mestre entram no PR seguinte da Fase 3.
  const sheet = deriveSheet({ character, inventory: record.inventory, adjustments: [], compendium });
  const index = indexOf(compendium);
  const names: Record<string, string> = {};
  // As seleções já feitas, para a lista de escolhas (com a opção de desfazer).
  const chosen = record.steps.flatMap((step) => step.selections.flatMap((sel) => [sel.source.id, ...sel.picks]));
  for (const id of [...referencedIds(sheet), ...chosen]) {
    const name = index.names.get(id);
    if (name !== undefined) names[id] = name;
  }
  const details: Record<string, string> = {};
  for (const p of sheet.pending) {
    const kind = p.options.pick === 'feat' || p.options.pick === 'spell' || p.options.pick === 'subclass' ? DETAIL_KIND[p.options.pick] : undefined;
    if (!kind) continue;
    for (const id of p.candidates) {
      const text = index.details.get(`${kind}:${id}`);
      if (text) details[id] = text;
    }
  }
  return { sheet, names, details };
}

/** Espécies, antecedentes e classes para os primeiros passos da criação. */
export function creationOptions(compendium: Compendium): CreationOptions {
  const byName = <T extends { name: string }>(list: readonly T[]): T[] => [...list].sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const { names } = indexOf(compendium);
  return {
    species: byName(compendium.species).map((s) => ({ id: s.id, name: s.name, sizes: s.sizes, speed: s.speed, traits: featureNames(s.levels) })),
    backgrounds: byName(compendium.backgrounds).map((b) => ({
      id: b.id,
      name: b.name,
      abilityOptions: b.abilityOptions,
      traits: b.levels.flatMap((l) => l.grants.flatMap((g) => (g.kind === 'feat' ? [`Talento: ${names.get(g.featId) ?? g.featId}`] : []))),
    })),
    classes: byName(compendium.classes).map((c) => ({
      id: c.id,
      name: c.name,
      hitDie: c.hitDie,
      primaryAbilities: c.primaryAbilities,
      traits: featureNames(c.levels.filter((l) => l.level === 1)),
    })),
  };
}
