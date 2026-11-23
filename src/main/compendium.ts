import type { Creature } from 'rules-engine';
import type { MonsterSummary } from '../shared/ipc';

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
