import { randomUUID } from 'node:crypto';
import { loadSrdCompendium } from 'rules-engine';
import { CharacterSchema } from 'rules-engine/schemas';
import { describe, expect, it } from 'vitest';
import dwarfFighter from '../../../packages/rules-engine/tests/fixtures/dwarf-fighter-5.json';
import elfWizard from '../../../packages/rules-engine/tests/fixtures/elf-wizard-7.json';
import { type ChatEntry, type SessionCharacter, SessionStateSchema } from '../../shared/protocol';
import { characterSheet } from '../character-sheet';
import { HostSession, type IntentOutcome } from './executor';

const compendium = loadSrdCompendium();
const GM = { playerId: randomUUID(), displayName: 'Mestre' };
const ANA = { playerId: randomUUID(), displayName: 'Ana' };
const BRUNO = { playerId: randomUUID(), displayName: 'Bruno' };

const applied = (o: IntentOutcome): boolean => o.result.status === 'applied';
const rejection = (o: IntentOutcome): string | undefined => (o.result.status === 'rejected' ? o.result.code : undefined);

/** Um personagem da Ana (maga 7 ou guerreiro 5) com o item equipado e sintonizado, e um goblin. */
function table(rolls: number[], itemId: string, options: { fighter?: boolean; ready?: boolean; quantity?: number } = {}) {
  let i = 0;
  const session = new HostSession({ id: randomUUID(), name: 'Mina' }, GM, {
    rng: { roll: () => rolls[i++ % rolls.length] ?? 1 },
    now: () => 1763769600000,
    newId: randomUUID,
    monsterExists: (id) => compendium.creatures.some((c) => c.id === id),
    assetExists: () => false,
    pruneSteps: (s) => s,
    itemProblems: () => [],
    characterSheet: (c) => characterSheet(c, compendium).sheet ?? undefined,
    monsterHpMax: (id) => compendium.creatures.find((c) => c.id === id)?.hp.average,
    creature: (id) => compendium.creatures.find((c) => c.id === id),
    item: (id) => compendium.items.find((x) => x.id === id),
    spell: (id) => compendium.spells.find((s) => s.id === id),
  });
  session.connect(ANA);
  session.connect(BRUNO);
  session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Caverna', width: 20, height: 20 } });
  const mapId = Object.keys(session.state.maps)[0] ?? '';
  session.handle(ANA.playerId, { kind: 'character.create', data: { name: 'Lia' } });
  const id = Object.keys(session.state.characters)[0] ?? '';
  const fixture = (options.fighter ? dwarfFighter : elfWizard) as unknown as { character: { baseScores: SessionCharacter['baseScores']; steps: unknown } };
  session.handle(ANA.playerId, { kind: 'character.update', data: { characterId: id, baseScores: fixture.character.baseScores ?? undefined, steps: CharacterSchema.shape.steps.parse(fixture.character.steps) } });
  session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Goblin', position: { x: 500, y: 0 }, size: 'small', monsterId: 'goblin_warrior' } });
  session.handle(ANA.playerId, { kind: 'inventory.add', data: { characterId: id, itemId, ...(options.quantity ? { quantity: options.quantity } : {}) } });
  const character = (): SessionCharacter => session.state.characters[id] as SessionCharacter;
  const instanceId = character().inventory.items[0]?.instanceId ?? '';
  if (options.ready !== false) session.handle(ANA.playerId, { kind: 'inventory.update', data: { characterId: id, instanceId, equipped: true, attuned: true } });
  const cast = (spellId: string, charges?: number, playerId = ANA.playerId) =>
    session.handle(playerId, { kind: 'item.cast', data: { characterId: id, instanceId, spellId, ...(charges !== undefined ? { charges } : {}) } });
  const change = (kind: 'spend' | 'restore', amount: number, playerId = ANA.playerId) =>
    session.handle(playerId, { kind: 'item.charges', data: { characterId: id, instanceId, change: kind, amount } });
  const dawn = (playerId = GM.playerId) => session.handle(playerId, { kind: 'items.dawn', data: {} });
  const spent = () => character().inventory.items[0]?.chargesSpent ?? 0;
  const sheet = () => characterSheet(character(), compendium).sheet;
  const last = <K extends ChatEntry['kind']>(kind: K) => session.state.chat.findLast((e): e is Extract<ChatEntry, { kind: K }> => e.kind === kind);
  const goblin = Object.keys(session.state.tokens)[0] ?? '';
  const valid = () => SessionStateSchema.safeParse(session.state).success;
  return { session, id, character, cast, change, dawn, spent, sheet, last, goblin, valid };
}

describe('HostSession: item charges and spells (note 0075)', () => {
  it('the Wand of Fireballs casts with its own DC, and each extra charge raises the level', () => {
    const t = table([2], 'wand_of_fireballs');
    expect(applied(t.cast('fireball'))).toBe(true);
    expect(t.spent()).toBe(1);
    expect(t.last('spell_cast')).toMatchObject({ using: { item: 'Wand of Fireballs' }, effect: { saveDc: 15, parts: [{ kind: 'save', damage: [{ dice: '8d6' }] }] } });
    expect(applied(t.cast('fireball', 3))).toBe(true);
    expect(t.spent()).toBe(4);
    const entry = t.last('spell_cast');
    expect(entry).toMatchObject({ effect: { parts: [{ damage: [{ dice: '10d6' }] }] } });
    expect(entry?.notes).toContain('Conjurada em círculo maior (5º)');
    expect(rejection(t.cast('fireball', 4))).toBe('rule_violation');
    expect(rejection(t.cast('fireball', 0))).toBe('rule_violation');
    expect(rejection(t.cast('magic_missile'))).toBe('rule_violation');
    // As partes valem como em qualquer magia: salvaguarda e proposta.
    expect(applied(t.session.handle(ANA.playerId, { kind: 'spell.effect', data: { entryId: entry?.id ?? '', part: 0, targetTokenIds: [t.goblin] } }))).toBe(true);
    expect(Object.values(t.session.state.proposals)).toHaveLength(1);
    expect(t.valid()).toBe(true);
  });

  it('a staff without a DC uses the DC of who holds it, with the fixed level of the item', () => {
    const t = table([5], 'staff_of_power');
    const dc = t.sheet()?.spellcasting.classes[0]?.saveDc.total;
    expect(applied(t.cast('fireball'))).toBe(true);
    expect(t.last('spell_cast')).toMatchObject({ effect: { saveDc: dc, parts: [{ damage: [{ dice: '10d6' }] }] } });
    expect(t.spent()).toBe(5);
  });

  it('works for who casts no spells: +0 and the proficiency bonus', () => {
    const t = table([5], 'wand_of_magic_missiles', { fighter: true });
    expect(applied(t.cast('magic_missile', 2))).toBe(true);
    expect(t.last('spell_cast')).toMatchObject({ effect: { saveDc: 8 + (t.sheet()?.proficiencyBonus ?? 0), parts: [{ kind: 'damage', count: 4 }] } });
  });

  it('needs to be attuned and equipped, unless the GM allows it; only the owner and the GM', () => {
    const t = table([5], 'wand_of_fireballs', { ready: false });
    expect(rejection(t.cast('fireball'))).toBe('rule_violation');
    expect(rejection(t.cast('fireball', 1, BRUNO.playerId))).toBe('not_allowed');
    expect(t.spent()).toBe(0);
    expect(applied(t.cast('fireball', 1, GM.playerId))).toBe(true);
    expect(t.last('spell_cast')?.notes.some((n) => n.startsWith('Permitido pelo mestre'))).toBe(true);
    // O cubo só precisa ser carregado, e não exige sintonização.
    const cube = table([5], 'cubic_gate', { ready: false });
    expect(applied(cube.cast('gate'))).toBe(true);
  });

  it('a Concentration spell from the item becomes the Concentration, even off the sheet', () => {
    const t = table([5], 'wand_of_binding', { fighter: true });
    expect(applied(t.cast('hold_person'))).toBe(true);
    expect(t.character().concentration?.spellId).toBe('hold_person');
    expect(t.last('spell_cast')).toMatchObject({ effect: { saveDc: 17 } });
    expect(t.valid()).toBe(true);
  });

  it('the last charge rolls 1d20: on a 1 the wand is destroyed', () => {
    const kept = table([2], 'wand_of_web');
    expect(applied(kept.change('spend', 6))).toBe(true);
    expect(applied(kept.cast('web'))).toBe(true);
    expect(kept.character().inventory.items).toHaveLength(1);
    expect(kept.last('item_charges')).toMatchObject({ event: 'last', d20: 2, available: 0 });
    expect(rejection(kept.cast('web'))).toBe('rule_violation');

    const gone = table([1], 'wand_of_web');
    gone.change('spend', 6);
    expect(applied(gone.cast('web'))).toBe(true);
    expect(gone.character().inventory.items).toEqual([]);
    expect(gone.last('item_charges')).toMatchObject({ event: 'destroyed', d20: 1 });
    expect(gone.valid()).toBe(true);

    // Outra consequência: o mestre aplica. A última carga do escaravelho o destrói sem rolar.
    const staff = table([20], 'staff_of_power');
    staff.change('spend', 20);
    expect(staff.last('item_charges')?.notes).toHaveLength(1);
    expect(staff.character().inventory.items).toHaveLength(1);
    const scarab = table([20], 'scarab_of_protection');
    scarab.change('spend', 12);
    expect(scarab.character().inventory.items).toEqual([]);
    expect(scarab.last('item_charges')).not.toHaveProperty('d20');
  });

  it('with two in the same entry, the next one comes charged', () => {
    const t = table([1], 'wand_of_web', { quantity: 2 });
    t.change('spend', 7);
    expect(t.character().inventory.items).toMatchObject([{ quantity: 1, chargesSpent: 0 }]);
  });

  it('two wands are two entries: they do not share charges', () => {
    const t = table([5], 'wand_of_web');
    t.session.handle(ANA.playerId, { kind: 'inventory.update', data: { characterId: t.id, instanceId: t.character().inventory.items[0]?.instanceId ?? '', equipped: false, attuned: false } });
    t.session.handle(ANA.playerId, { kind: 'inventory.add', data: { characterId: t.id, itemId: 'wand_of_web' } });
    expect(t.character().inventory.items).toHaveLength(2);
  });

  it('dawn is of the GM, rolls each item and never passes the maximum', () => {
    const t = table([3], 'wand_of_fireballs');
    t.change('spend', 6);
    expect(rejection(t.dawn(ANA.playerId))).toBe('not_allowed');
    expect(applied(t.dawn())).toBe(true);
    // 1d6+1 = 4.
    expect(t.spent()).toBe(2);
    expect(t.last('dawn')?.items).toMatchObject([{ itemName: 'Wand of Fireballs', dice: '1d6+1', rolled: 4, available: 5, max: 7 }]);
    expect(applied(t.dawn())).toBe(true);
    expect(t.spent()).toBe(0);
    expect(applied(t.dawn())).toBe(true);
    expect(t.last('dawn')?.items).toEqual([]);
    expect(t.valid()).toBe(true);
  });

  it('charges are counted by hand within the limits', () => {
    const t = table([5], 'wand_of_secrets');
    expect(rejection(t.change('restore', 1))).toBe('rule_violation');
    expect(rejection(t.change('spend', 4))).toBe('rule_violation');
    expect(rejection(t.change('spend', 1, BRUNO.playerId))).toBe('not_allowed');
    expect(applied(t.change('spend', 2))).toBe(true);
    expect(t.sheet()?.inventory[0]?.charges).toMatchObject({ max: 3, available: 1, regain: '1d3' });
    expect(applied(t.change('restore', 2))).toBe(true);
    expect(t.spent()).toBe(0);
    const rope = table([5], 'rope');
    expect(rejection(rope.change('spend', 1))).toBe('rule_violation');
  });
});
