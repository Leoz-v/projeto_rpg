import { availableUses } from 'rules-engine';
import { type Intent, type PatchOp, type Role, toPointer } from '../../shared/protocol';
import { type SessionContext, violation } from './context';

/** Recursos de uso limitado (nota 0052). Funções do executor da sessão (`HostSession`), sobre o `SessionContext`. */

/** Gasta ou recupera usos de um recurso da ficha. */
export function changeResource(ctx: SessionContext, playerId: string, role: Role, intent: Extract<Intent, { kind: 'resource.spend' | 'resource.restore' }>): PatchOp[] {
  const { character, sheet } = ctx.sheetOf(playerId, role, intent.data.characterId);
  const resource = sheet.resources.find((r) => r.id === intent.data.resourceId);
  if (!resource) throw violation(`${character.name} não tem esse recurso`);
  const amount = intent.data.amount ?? 1;
  const available = availableUses(resource.max, character.resourcesSpent, resource.id);
  const spend = intent.kind === 'resource.spend';
  if (spend && amount > available) throw violation(`${resource.name}: restam ${available} de ${resource.max}`);
  const spentNow = Math.min(character.resourcesSpent[resource.id] ?? 0, resource.max);
  if (!spend && amount > spentNow) throw violation(`${resource.name}: só ${spentNow} gasto(s) para recuperar`);
  const used = spentNow + (spend ? amount : -amount);
  const resourcesSpent = Object.fromEntries([...Object.entries(character.resourcesSpent).filter(([id]) => id !== resource.id), ...(used > 0 ? [[resource.id, used] as const] : [])]);
  return [
    { op: 'replace', path: toPointer('characters', character.id, 'resourcesSpent'), value: resourcesSpent },
    ctx.appendChat({
      kind: 'resource',
      ...ctx.entryBase(playerId),
      characterId: character.id,
      characterName: character.name,
      resourceName: resource.name.slice(0, 100),
      event: spend ? 'spent' : 'restored',
      amount,
      available: resource.max - used,
      max: resource.max,
    }),
  ];
}
