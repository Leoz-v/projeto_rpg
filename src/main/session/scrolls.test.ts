import { randomUUID } from 'node:crypto';
import { inventoryEntryProblems, loadSrdCompendium, scrollOf, scrollReading } from 'rules-engine';
import { CharacterSchema } from 'rules-engine/schemas';
import { describe, expect, it } from 'vitest';
import dwarfFighter from '../../../packages/rules-engine/tests/fixtures/dwarf-fighter-5.json';
import elfWizard from '../../../packages/rules-engine/tests/fixtures/elf-wizard-7.json';
import { type ChatEntry, type SessionCharacter, SessionStateSchema } from '../../shared/protocol';
import { characterSheet } from '../character-sheet';
import { searchItems } from '../compendium';
import { HostSession, type IntentOutcome } from './executor';

const compendium = loadSrdCompendium();
const GM = { playerId: randomUUID(), displayName: 'Mestre' };
const ANA = { playerId: randomUUID(), displayName: 'Ana' };
const BRUNO = { playerId: randomUUID(), displayName: 'Bruno' };

const applied = (o: IntentOutcome): boolean => o.result.status === 'applied';
const rejection = (o: IntentOutcome): string | undefined => (o.result.status === 'rejected' ? o.result.code : undefined);

/** Uma maga 7 (até o 4º círculo) ou um guerreiro 5 com o pergaminho. */
function table(rolls: number[], scroll: { variantId: string; spellId?: string; quantity?: number }, fighter = false) {
  let i = 0;
  const session = new HostSession({ id: randomUUID(), name: 'Mina' }, GM, {
    rng: { roll: () => rolls[i++ % rolls.length] ?? 1 },
    now: () => 1763769600000,
    newId: randomUUID,
    monsterExists: (id) => compendium.creatures.some((c) => c.id === id),
    assetExists: () => false,
    pruneSteps: (s) => s,
    itemProblems: (entry) => inventoryEntryProblems(entry, compendium),
    characterSheet: (c) => characterSheet(c, compendium).sheet ?? undefined,
    monsterHpMax: (id) => compendium.creatures.find((c) => c.id === id)?.hp.average,
    creature: (id) => compendium.creatures.find((c) => c.id === id),
    item: (id) => compendium.items.find((x) => x.id === id),
    spell: (id) => compendium.spells.find((s) => s.id === id),
  });
  session.connect(ANA);
  session.connect(BRUNO);
  session.handle(ANA.playerId, { kind: 'character.create', data: { name: 'Lia' } });
  const id = Object.keys(session.state.characters)[0] ?? '';
  const fixture = (fighter ? dwarfFighter : elfWizard) as unknown as { character: { baseScores: SessionCharacter['baseScores']; steps: unknown } };
  session.handle(ANA.playerId, { kind: 'character.update', data: { characterId: id, baseScores: fixture.character.baseScores ?? undefined, steps: CharacterSchema.shape.steps.parse(fixture.character.steps) } });
  const add = (data: typeof scroll) => session.handle(ANA.playerId, { kind: 'inventory.add', data: { characterId: id, itemId: 'spell_scroll', ...data } });
  const added = add(scroll);
  const character = (): SessionCharacter => session.state.characters[id] as SessionCharacter;
  const read = (playerId = ANA.playerId) => session.handle(playerId, { kind: 'item.read', data: { characterId: id, instanceId: character().inventory.items[0]?.instanceId ?? 'x' } });
  const sheet = () => characterSheet(character(), compendium).sheet;
  const last = <K extends ChatEntry['kind']>(kind: K) => session.state.chat.findLast((e): e is Extract<ChatEntry, { kind: K }> => e.kind === kind);
  const valid = () => SessionStateSchema.safeParse(session.state).success;
  return { session, id, added, add, character, read, sheet, last, valid };
}

describe('HostSession: spell scrolls (note 0076)', () => {
  it('casts with the DC and the attack bonus of the scroll, and spends it', () => {
    const t = table([10], { variantId: 'level_3', spellId: 'fireball', quantity: 2 });
    expect(applied(t.read())).toBe(true);
    expect(t.last('spell_cast')).toMatchObject({ spellName: 'Fireball', using: { item: 'Spell Scroll' }, effect: { saveDc: 15, attackBonus: 7, parts: [{ damage: [{ dice: '8d6' }] }] } });
    expect(t.last('scroll_check')).toBeUndefined();
    expect(t.character().inventory.items[0]?.quantity).toBe(1);
    expect(applied(t.read())).toBe(true);
    expect(t.character().inventory.items).toEqual([]);
    expect(t.character().spellSlotsSpent.byLevel).toEqual({});
    expect(t.valid()).toBe(true);
  });

  it('above what the character casts, the Host rolls the check; a failure loses the scroll without casting', () => {
    const ok = table([20], { variantId: 'level_6', spellId: 'disintegrate' });
    const modifier = ok.sheet()?.abilities.int.modifier;
    expect(applied(ok.read())).toBe(true);
    expect(ok.last('scroll_check')).toMatchObject({ ability: 'int', dc: 16, natural: 20, modifier, success: true });
    expect(ok.last('spell_cast')).toMatchObject({ effect: { saveDc: 17 } });
    expect(ok.character().inventory.items).toEqual([]);

    const fail = table([2], { variantId: 'level_6', spellId: 'disintegrate' });
    expect(applied(fail.read())).toBe(true);
    expect(fail.last('scroll_check')).toMatchObject({ success: false });
    expect(fail.last('spell_cast')).toBeUndefined();
    expect(fail.character().inventory.items).toEqual([]);
    expect(fail.valid()).toBe(true);
  });

  it('off the spell list it is unreadable and is not spent, unless the GM allows it', () => {
    const t = table([10], { variantId: 'level_1', spellId: 'cure_wounds' });
    expect(t.sheet()?.inventory[0]?.scroll).toEqual({ spell: 'Cure Wounds', problem: 'Fora da lista de magias' });
    expect(rejection(t.read())).toBe('rule_violation');
    expect(rejection(t.read(BRUNO.playerId))).toBe('not_allowed');
    expect(t.character().inventory.items).toHaveLength(1);
    expect(applied(t.read(GM.playerId))).toBe(true);
    expect(t.last('spell_cast')?.notes).toContain('Permitido pelo mestre: fora da lista de magias do personagem');

    const fighter = table([10], { variantId: 'cantrip', spellId: 'fire_bolt' }, true);
    expect(rejection(fighter.read())).toBe('rule_violation');
  });

  it('a Concentration spell from the scroll becomes the Concentration', () => {
    const t = table([10], { variantId: 'level_2', spellId: 'hold_person' });
    expect(applied(t.read())).toBe(true);
    expect(t.character().concentration?.spellId).toBe('hold_person');
  });

  it('a new scroll needs a spell of its level; only equal scrolls stack', () => {
    expect(rejection(table([1], { variantId: 'level_3' }).added)).toBe('rule_violation');
    expect(rejection(table([1], { variantId: 'level_2', spellId: 'fireball' }).added)).toBe('rule_violation');
    const t = table([1], { variantId: 'level_3', spellId: 'fireball' });
    t.add({ variantId: 'level_3', spellId: 'fireball' });
    t.add({ variantId: 'level_3', spellId: 'lightning_bolt' });
    expect(t.character().inventory.items.map((e) => [e.spellId, e.quantity])).toEqual([['fireball', 2], ['lightning_bolt', 1]]);
    expect(rejection(t.session.handle(ANA.playerId, { kind: 'inventory.add', data: { characterId: t.id, itemId: 'rope', spellId: 'fireball' } }))).toBe('rule_violation');
  });

  it('an old scroll without a spell stays in the sheet and cannot be read', () => {
    const t = table([1], { variantId: 'level_3', spellId: 'fireball' });
    const [entry] = t.character().inventory.items;
    if (!entry) throw new Error('sem pergaminho');
    delete entry.spellId;
    expect(t.sheet()?.inventory[0]?.scroll).toEqual({ spell: null, problem: 'Sem magia definida' });
    expect(t.sheet()?.issues.filter((i) => i.code === 'invalid_item')).toEqual([]);
    expect(rejection(t.read())).toBe('rule_violation');
  });

  it('every level of the SRD table, and the spells to choose from', () => {
    const item = compendium.items.find((i) => i.id === 'spell_scroll');
    const stats = ['cantrip', ...Array.from({ length: 9 }, (_, n) => `level_${n + 1}`)].map((v) => scrollOf(item, v));
    expect(stats.map((s) => s && [s.level, s.saveDc, s.attackBonus])).toEqual([
      [0, 13, 5], [1, 13, 5], [2, 13, 5], [3, 15, 7], [4, 15, 7], [5, 17, 9], [6, 17, 9], [7, 18, 10], [8, 18, 10], [9, 19, 11],
    ]);
    const variants = searchItems(compendium, 'spell scroll')[0]?.variants ?? [];
    expect(variants.flatMap((v) => v.spells ?? [])).toHaveLength(compendium.spells.length);
  });

  it('reads with the best ability among the classes that have the spell', () => {
    const t = table([1], { variantId: 'cantrip', spellId: 'fire_bolt' });
    const sheet = t.sheet();
    if (!sheet) throw new Error('sem ficha');
    expect(scrollReading({ level: 4, classes: ['wizard'] }, sheet)).not.toHaveProperty('checkDc');
    expect(scrollReading({ level: 5, classes: ['wizard'] }, sheet)).toMatchObject({ onList: true, ability: 'int', checkDc: 15 });
    expect(scrollReading({ level: 1, classes: ['cleric'] }, sheet)).toMatchObject({ onList: false });
  });
});
