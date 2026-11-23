import { baseItemOptions, type Compendium, type Creature } from 'rules-engine';
import type { ItemSummary, MonsterAction, MonsterSummary } from '../shared/ipc';

/**
 * Consultas ao compêndio para a tela. O compêndio fica no processo main (o
 * pacote da tela não o carrega, nota 0022): a tela pede por IPC só o que exibe.
 */

/** Sem acento e em minúsculas, para "dragao" achar "Dragão" e "goblin" achar "Goblin". */
const normalize = (text: string): string => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Monstros cujo nome contém `query`; os que começam com ela vêm primeiro, depois por nome. */
export function searchMonsters(creatures: readonly Creature[], query: string, limit = 20): MonsterSummary[] {
  const q = normalize(query.trim());
  if (q === '') return [];
  return creatures
    .map((c) => ({ c, name: normalize(c.name) }))
    .filter(({ name }) => name.includes(q))
    .sort((a, b) => Number(b.name.startsWith(q)) - Number(a.name.startsWith(q)) || a.c.name.localeCompare(b.c.name, 'en'))
    .slice(0, limit)
    .map(({ c }) => ({ id: c.id, name: c.name, size: c.size[0] ?? 'medium', cr: c.cr }));
}

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'very_rare', 'legendary', 'artifact'];

/** Itens cujo nome contém `query`, com as variantes e os itens base que a tela precisa para escolher. */
export function searchItems(compendium: Compendium, query: string, limit = 30): ItemSummary[] {
  const q = normalize(query.trim());
  if (q === '') return [];
  return compendium.items
    .map((item) => ({ item, name: normalize(item.name) }))
    .filter(({ name }) => name.includes(q))
    .sort((a, b) => Number(b.name.startsWith(q)) - Number(a.name.startsWith(q)) || a.item.name.localeCompare(b.item.name, 'en'))
    .slice(0, limit)
    .map(({ item }): ItemSummary => {
      if (item.kind !== 'magic_item') return { id: item.id, name: item.name, kind: item.kind, attunement: item.activation === 'attuned', variants: [], bases: [] };
      const rarities = item.rarity ? [item.rarity] : item.variants.map((v) => v.rarity);
      const rarity = [...new Set(rarities)].sort((a, b) => RARITY_ORDER.indexOf(a) - RARITY_ORDER.indexOf(b));
      return {
        id: item.id,
        name: item.name,
        kind: item.kind,
        rarity,
        attunement: item.attunement !== undefined,
        ...(item.attunement?.by !== undefined ? { attunementBy: item.attunement.by } : {}),
        variants: item.variants.map((v) => ({ id: v.id, name: v.name })),
        bases: baseItemOptions(item, compendium).map((b) => ({ id: b.id, name: b.name })),
      };
    });
}

/** Ações de ataque e de salvaguarda de um monstro (as de texto e Spellcasting ficam no bloco, para o mestre). */
export function monsterActions(creatures: readonly Creature[], monsterId: string): MonsterAction[] {
  const creature = creatures.find((c) => c.id === monsterId);
  if (!creature) return [];
  return creature.actions.flatMap((a): MonsterAction[] => {
    const damage = a.kind === 'attack' || a.kind === 'save' ? a.damage.map((d) => ({ dice: d.dice, type: d.type })) : [];
    if (a.kind === 'attack') {
      return [
        {
          kind: 'attack',
          id: a.id,
          name: a.name,
          toHit: a.toHit,
          damage,
          ...(a.reach !== undefined ? { reach: a.reach } : {}),
          ...(a.range !== undefined ? { range: a.range } : {}),
        },
      ];
    }
    if (a.kind === 'save') {
      return [{ kind: 'save', id: a.id, name: a.name, ability: a.ability, dc: a.dc, damage, onSuccess: a.onSuccess, conditions: a.onFailConditions }];
    }
    return [];
  });
}
