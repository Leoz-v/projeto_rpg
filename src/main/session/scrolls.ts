import { abilityCheckD20, d20StepNotes, rollD20, scrollOf, scrollReading } from 'rules-engine';
import { type IntentData, type PatchOp, type Role, toPointer } from '../../shared/protocol';
import { inventoryEntry } from './characters';
import { type SessionContext, violation } from './context';
import { itemSpellEntry } from './item-charges';
import { concentrate } from './vitality';

/** Pergaminhos de magia (nota 0076). Funções do executor da sessão (`HostSession`), sobre o `SessionContext`. */

/**
 * Lê o pergaminho: conjura a magia dele e o consome. De círculo acima do que o
 * personagem conjura, o Host rola o teste; na falha, o pergaminho se perde. O
 * mestre passa por cima da lista da classe, sem teste.
 */
export function readScroll(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'item.read'>): PatchOp[] {
  const { character, sheet } = ctx.sheetOf(playerId, role, data.characterId);
  const { entry, index } = inventoryEntry(ctx, character, data.instanceId);
  const item = ctx.deps.item(entry.itemId);
  const scroll = scrollOf(item, entry.variantId);
  if (!item || !scroll) throw violation('Este item não é um pergaminho de magia');
  const spell = entry.spellId !== undefined ? ctx.deps.spell(entry.spellId) : undefined;
  if (!spell) throw violation('Este pergaminho não tem magia definida: remova e adicione de novo, escolhendo a magia');
  if (!sheet.spellcasting.canCast) throw violation(`${character.name} não pode conjurar vestindo armadura sem treinamento`);
  const reading = scrollReading(spell, sheet);
  if (!reading.onList && role !== 'gm') throw violation(`${spell.name} não está na lista de magias de ${character.name}: o pergaminho é ilegível`);

  const path = toPointer('characters', character.id, 'inventory', 'items', String(index));
  const left = entry.quantity - 1;
  const ops: PatchOp[] = [left > 0 ? { op: 'replace', path: `${path}/quantity`, value: left } : { op: 'remove', path }];
  // Conjurar, mesmo falhando, interrompe o descanso (truques, não).
  if (spell.level > 0) ops.push(...ctx.leaveRest(playerId, character, 'Conjurou uma magia: o descanso não vale'));

  if (reading.checkDc !== undefined) {
    const d20 = abilityCheckD20(sheet, reading.ability);
    const result = rollD20({ ...d20.input, dc: reading.checkDc }, ctx.deps.rng);
    const success = result.success === true;
    ops.unshift(
      ctx.appendChat({
        kind: 'scroll_check',
        ...ctx.entryBase(playerId),
        characterId: character.id,
        characterName: character.name,
        spellName: spell.name.slice(0, 100),
        ability: reading.ability,
        dc: reading.checkDc,
        mode: d20.input.mode,
        dice: result.dice,
        natural: result.natural,
        modifier: d20.input.modifier,
        total: result.total,
        success,
        advantage: d20.advantage,
        disadvantage: d20.disadvantage,
        notes: [...d20StepNotes(result.steps), ...d20.reminders].slice(0, 50),
      }),
    );
    if (!success) return ops;
  }
  const name = `${item.name} (${left > 0 ? `restam ${left}` : 'consumido'})`;
  return [
    ...ops,
    itemSpellEntry(ctx, playerId, {
      character,
      sheet,
      spell,
      level: spell.level,
      itemName: item.name,
      caster: { ability: reading.ability, modifier: reading.modifier, saveDc: scroll.saveDc, attackBonus: scroll.attackBonus },
      notes: [name, ...(reading.onList ? [] : ['Permitido pelo mestre: fora da lista de magias do personagem'])],
    }),
    ...(spell.concentration && character.concentration?.spellId !== spell.id ? concentrate(ctx, playerId, role, character.id, spell.id, true) : []),
  ];
}
