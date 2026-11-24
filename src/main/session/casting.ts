import { availableSpellSlots, availableUses } from 'rules-engine';
import type { IntentData, PatchOp, Role } from '../../shared/protocol';
import { type SessionContext, violation } from './context';
import { changeResource } from './resources';
import { changeSpellSlot } from './spell-slots';
import { concentrate } from './vitality';

/** Conjurar (nota 0053). Funções do executor da sessão (`HostSession`), sobre o `SessionContext`. */

/** Tira os registros do chat: o gasto do espaço ou do uso vai na entrada `spell_cast`. */
const withoutChat = (ops: PatchOp[]): PatchOp[] => ops.filter((op) => !op.path.startsWith('/chat/'));

/**
 * Conjura uma magia da ficha: gasta o espaço (ou o uso da magia concedida),
 * vira a Concentração do personagem se a magia exigir, tira do descanso
 * (menos truque) e publica a magia no chat. O efeito fica com a mesa.
 */
export function castSpell(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'spell.cast'>): PatchOp[] {
  const { character, sheet } = ctx.sheetOf(playerId, role, data.characterId);
  const { spellcasting } = sheet;
  if (!spellcasting.canCast) throw violation(`${character.name} não pode conjurar vestindo armadura sem treinamento`);
  const castable = spellcasting.castable.find((c) => c.spellId === data.spellId);
  const spell = ctx.deps.spell(data.spellId);
  if (!castable || !spell) throw violation(`${character.name} não conhece essa magia`);

  const notes: string[] = [];
  let ops: PatchOp[] = [];
  const { using } = data;
  if (using === 'ritual') {
    if (!castable.ritual || castable.level === 0) throw violation(`${spell.name} não é um ritual`);
    notes.push('Ritual: sem espaço, 10 minutos a mais');
  } else if (using === 'free') {
    const { free } = castable;
    if (free === undefined) throw violation(`${spell.name} precisa de um espaço de magia`);
    if (typeof free === 'object') {
      const resource = sheet.resources.find((r) => r.id === free.resourceId);
      if (!resource) throw violation(`${spell.name} não tem uso gratuito`);
      ops = withoutChat(changeResource(ctx, playerId, role, { kind: 'resource.spend', data: { characterId: character.id, resourceId: resource.id } }));
      notes.push(`Uso de ${resource.name}: ${availableUses(resource.max, character.resourcesSpent, resource.id) - 1}/${resource.max}`);
    }
  } else {
    if (!castable.slots) throw violation(`${spell.name} não usa espaço de magia`);
    const slotLevel = using.slot === 'pact' ? spellcasting.pactSlots?.level : using.slot.level;
    if (slotLevel === undefined || slotLevel < castable.level) throw violation(`${spell.name} é de ${castable.level}º círculo: o espaço precisa ser desse círculo ou maior`);
    ops = withoutChat(changeSpellSlot(ctx, playerId, role, { kind: 'spell_slot.spend', data: { characterId: character.id, slot: using.slot } }));
    const pools = availableSpellSlots(spellcasting, character.spellSlotsSpent);
    const pool = using.slot === 'pact' ? pools.pact : pools.levels.find((p) => p.level === slotLevel);
    const label = using.slot === 'pact' ? `Espaço de Pacto (${slotLevel}º)` : `Espaço de ${slotLevel}º círculo`;
    if (pool) notes.push(`${label}: ${pool.available - 1}/${pool.total}`);
    if (slotLevel > castable.level) notes.push(`Conjurada em círculo maior (${slotLevel}º)`);
  }

  // Concentração: a magia nova substitui a anterior; a mesma magia de novo mantém.
  if (castable.concentration && character.concentration?.spellId !== spell.id) {
    ops.push(...concentrate(ctx, playerId, role, character.id, spell.id));
  }
  // Conjurar uma magia que não seja truque interrompe o descanso (SRD 5.2.1, "Short Rest").
  if (castable.level > 0) ops.push(...ctx.leaveRest(playerId, character, 'Conjurou uma magia: o descanso não vale'));

  return [
    ctx.appendChat({
      kind: 'spell_cast',
      ...ctx.entryBase(playerId),
      characterId: character.id,
      characterName: character.name,
      spellName: spell.name.slice(0, 100),
      level: castable.level,
      using,
      castingTime: spell.castingTime.slice(0, 100),
      range: spell.range.slice(0, 100),
      duration: spell.duration.slice(0, 100),
      concentration: castable.concentration,
      description: spell.description.slice(0, 6000),
      notes,
    }),
    ...ops,
  ];
}
