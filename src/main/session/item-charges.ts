import { availableCharges, type ChargedItem, chargedItem, itemCaster, itemMagicProblems, itemSpellCosts, itemSpellLevel, lastChargeOutcome, resolveSpellParts, rollDice, usedItemName } from 'rules-engine';
import { type ChatEntry, type IntentData, type PatchOp, type Role, type SessionCharacter, toPointer } from '../../shared/protocol';
import { inventoryEntry } from './characters';
import { type InventoryEntry, type SessionContext, violation } from './context';
import { concentrate } from './vitality';

/** Cargas e magias de itens (nota 0075). Funções do executor da sessão (`HostSession`), sobre o `SessionContext`. */

interface Charged {
  character: SessionCharacter;
  entry: InventoryEntry;
  path: string;
  charged: ChargedItem;
  name: string;
}

function chargedEntry(ctx: SessionContext, character: SessionCharacter, instanceId: string): Charged {
  const { entry, index } = inventoryEntry(ctx, character, instanceId);
  const charged = chargedItem(ctx.deps.item(entry.itemId));
  if (!charged) throw violation('Este item não tem cargas');
  return { character, entry, charged, path: toPointer('characters', character.id, 'inventory', 'items', String(index)), name: usedItemName(charged.item, entry.variantId).slice(0, 100) };
}

/** `replace` precisa do campo: entradas antigas não têm `chargesSpent`. */
const setSpent = (c: Charged, spent: number): PatchOp => ({ op: c.entry.chargesSpent === undefined ? 'add' : 'replace', path: `${c.path}/chargesSpent`, value: spent });

const chargesEntry = (ctx: SessionContext, playerId: string, c: Charged, change: Pick<Extract<ChatEntry, { kind: 'item_charges' }>, 'event' | 'amount' | 'available'> & { d20?: number; notes?: string[] }): PatchOp =>
  ctx.appendChat({ kind: 'item_charges', ...ctx.entryBase(playerId), characterId: c.character.id, characterName: c.character.name, itemName: c.name, max: c.charged.max, notes: [], ...change });

/** Gasta cargas; na última, o Host rola o d20 do item, que pode destruí-lo. */
function spendCharges(ctx: SessionContext, playerId: string, c: Charged, amount: number): { ops: PatchOp[]; left: number } {
  const available = availableCharges(c.charged.max, c.entry);
  if (amount > available) throw violation(`${c.name}: restam ${available} de ${c.charged.max} cargas`);
  const left = available - amount;
  const ops: PatchOp[] = amount > 0 ? [setSpent(c, c.charged.max - left)] : [];
  const rule = c.charged.item.charges?.lastCharge;
  if (amount === 0 || left > 0 || rule === undefined) return { ops, left };
  const d20 = rule === 'destroyed' ? undefined : rollDice('1d20', ctx.deps.rng).total;
  const outcome = lastChargeOutcome(rule, d20 ?? 0);
  if (outcome === 'destroyed') {
    // Com mais de uma unidade na entrada, a próxima vem carregada.
    const destroy: PatchOp[] =
      c.entry.quantity > 1
        ? [{ op: 'replace', path: `${c.path}/quantity`, value: c.entry.quantity - 1 }, setSpent(c, 0)]
        : [{ op: 'remove', path: c.path }];
    return { ops: [...destroy, chargesEntry(ctx, playerId, c, { event: 'destroyed', amount, available: 0, ...(d20 !== undefined ? { d20 } : {}) })], left };
  }
  const notes = outcome === 'gm' ? ['O texto do item tem uma consequência para este resultado: o mestre aplica'] : [];
  return { ops: [...ops, chargesEntry(ctx, playerId, c, { event: 'last', amount, available: 0, ...(d20 !== undefined ? { d20 } : {}), notes })], left };
}

/** Gasta ou devolve cargas à mão (propriedades que a mesa não resolve). */
export function changeCharges(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'item.charges'>): PatchOp[] {
  const c = chargedEntry(ctx, ctx.ownCharacter(playerId, role, data.characterId), data.instanceId);
  if (data.change === 'spend') {
    const spent = spendCharges(ctx, playerId, c, data.amount);
    return [chargesEntry(ctx, playerId, c, { event: 'spent', amount: data.amount, available: spent.left }), ...spent.ops];
  }
  const missing = c.charged.max - availableCharges(c.charged.max, c.entry);
  if (data.amount > missing) throw violation(`${c.name}: só ${missing} carga(s) gasta(s) para devolver`);
  return [setSpent(c, missing - data.amount), chargesEntry(ctx, playerId, c, { event: 'restored', amount: data.amount, available: c.charged.max - missing + data.amount })];
}

/** Amanhecer (o mestre): os itens de todos os personagens recuperam cargas, rolados pelo Host. */
export function dawn(ctx: SessionContext, playerId: string): PatchOp[] {
  const ops: PatchOp[] = [];
  const items: Extract<ChatEntry, { kind: 'dawn' }>['items'] = [];
  for (const character of Object.values(ctx.current.characters)) {
    for (const entry of character.inventory.items) {
      const charged = chargedItem(ctx.deps.item(entry.itemId));
      if (charged?.regain === undefined || (entry.chargesSpent ?? 0) === 0) continue;
      const c = chargedEntry(ctx, character, entry.instanceId);
      const rolled = Math.max(0, rollDice(charged.regain, ctx.deps.rng).total);
      const available = Math.min(charged.max, availableCharges(charged.max, entry) + rolled);
      ops.push(setSpent(c, charged.max - available));
      items.push({ characterId: character.id, characterName: character.name, itemName: c.name, dice: charged.regain, rolled, available, max: charged.max });
    }
  }
  return [ctx.appendChat({ kind: 'dawn', ...ctx.entryBase(playerId), items: items.slice(0, 200) }), ...ops];
}

/**
 * Conjura uma magia pelo item: gasta as cargas e publica a magia como
 * qualquer outra (`spell_cast`), com a CD do item ou a de quem o segura. O
 * mestre passa por cima da sintonização e de equipar.
 */
export function castFromItem(ctx: SessionContext, playerId: string, role: Role, data: IntentData<'item.cast'>): PatchOp[] {
  const { character, sheet } = ctx.sheetOf(playerId, role, data.characterId);
  const c = chargedEntry(ctx, character, data.instanceId);
  const { item } = c.charged;
  const known = item.casting?.spells.find((s) => s.spellId === data.spellId);
  const spell = ctx.deps.spell(data.spellId);
  if (!known || !spell) throw violation(`${c.name} não conjura essa magia`);
  if (!sheet.spellcasting.canCast) throw violation(`${character.name} não pode conjurar vestindo armadura sem treinamento`);
  const problems = itemMagicProblems(item, c.entry);
  if (role !== 'gm' && problems[0] !== undefined) throw violation(problems[0]);
  const charges = data.charges ?? known.charges;
  if (!itemSpellCosts(known).includes(charges)) throw violation(`${spell.name} não custa ${charges} carga(s) neste item`);

  const spent = spendCharges(ctx, playerId, c, charges);
  const level = itemSpellLevel(known, spell.level, charges);
  const caster = itemCaster(item, sheet);
  const parts = resolveSpellParts(spell, { slotLevel: level, characterLevel: sheet.level, modifier: caster.modifier });
  return [
    ctx.appendChat({
      kind: 'spell_cast',
      ...ctx.entryBase(playerId),
      characterId: character.id,
      characterName: character.name,
      spellName: spell.name.slice(0, 100),
      level: spell.level,
      using: { item: c.name },
      castingTime: spell.castingTime.slice(0, 100),
      range: spell.range.slice(0, 100),
      duration: spell.duration.slice(0, 100),
      concentration: spell.concentration,
      description: spell.description.slice(0, 6000),
      notes: [
        `${c.name}: ${charges} carga(s), restam ${spent.left}/${c.charged.max}`,
        ...(level > spell.level ? [`Conjurada em círculo maior (${level}º)`] : []),
        ...(known.note !== undefined ? [known.note] : []),
        ...problems.map((p) => `Permitido pelo mestre: ${p}`),
      ],
      ...(parts.length > 0
        ? {
            effect: {
              spellId: spell.id,
              ability: caster.ability,
              saveDc: caster.saveDc,
              attackBonus: caster.attackBonus,
              parts: parts.map((p) => (p.label ? { ...p, label: p.label.slice(0, 100) } : p)),
            },
          }
        : {}),
    }),
    ...spent.ops,
    ...(spell.concentration && character.concentration?.spellId !== spell.id ? concentrate(ctx, playerId, role, character.id, spell.id, true) : []),
    ...(spell.level > 0 ? ctx.leaveRest(playerId, character, 'Conjurou uma magia: o descanso não vale') : []),
  ];
}
