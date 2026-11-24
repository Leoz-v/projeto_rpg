import { availableSpellSlots } from 'rules-engine';
import { type Intent, type PatchOp, type Role, type SessionCharacter, toPointer } from '../../shared/protocol';
import { type SessionContext, violation } from './context';

/** Espaços de magia gastos e recuperados (nota 0051). Funções do executor da sessão (`HostSession`), sobre o `SessionContext`. */

/** Gasta ou recupera um espaço de magia (de um círculo, ou da Magia de Pacto), conferindo a ficha. */
export function changeSpellSlot(ctx: SessionContext, playerId: string, role: Role, intent: Extract<Intent, { kind: 'spell_slot.spend' | 'spell_slot.restore' }>): PatchOp[] {
  const { character, sheet } = ctx.sheetOf(playerId, role, intent.data.characterId);
  const { slot } = intent.data;
  const pools = availableSpellSlots(sheet.spellcasting, character.spellSlotsSpent);
  const pool = slot === 'pact' ? pools.pact : pools.levels.find((p) => p.level === slot.level);
  const label = slot === 'pact' ? 'da Magia de Pacto' : `de ${slot.level}º círculo`;
  if (!pool) throw violation(`${character.name} não tem espaços ${label}`);
  const spend = intent.kind === 'spell_slot.spend';
  if (spend && pool.available === 0) throw violation(`${character.name} não tem espaço ${label} disponível`);
  if (!spend && pool.available === pool.total) throw violation(`${character.name} não gastou nenhum espaço ${label}`);
  const delta = spend ? 1 : -1;
  const spent = character.spellSlotsSpent;
  let next: SessionCharacter['spellSlotsSpent'];
  if (slot === 'pact') {
    next = { ...spent, pact: Math.max(0, spent.pact + delta) };
  } else {
    const key = String(slot.level) as keyof SessionCharacter['spellSlotsSpent']['byLevel'];
    const count = Math.max(0, (spent.byLevel[key] ?? 0) + delta);
    // Círculo sem nada gasto sai do registro.
    const byLevel = Object.fromEntries([...Object.entries(spent.byLevel).filter(([k]) => k !== key), ...(count > 0 ? [[key, count] as const] : [])]);
    next = { ...spent, byLevel };
  }
  return [
    { op: 'replace', path: toPointer('characters', character.id, 'spellSlotsSpent'), value: next },
    ctx.appendChat({
      kind: 'spell_slot',
      ...ctx.entryBase(playerId),
      characterId: character.id,
      characterName: character.name,
      event: spend ? 'spent' : 'restored',
      slot,
      available: pool.available - delta,
      total: pool.total,
    }),
  ];
}
