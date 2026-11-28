import { randomUUID } from 'node:crypto';
import { loadSrdCompendium } from 'rules-engine';
import { CharacterSchema } from 'rules-engine/schemas';
import { describe, expect, it } from 'vitest';
import dwarfFighter from '../../../packages/rules-engine/tests/fixtures/dwarf-fighter-5.json';
import halflingBard from '../../../packages/rules-engine/tests/fixtures/halfling-bard-6.json';
import { type ChatEntry, type SessionCharacter, SessionStateSchema } from '../../shared/protocol';
import { characterSheet } from '../character-sheet';
import { HostSession, type IntentOutcome } from './executor';
import { viewOf } from './visibility';

/** Dados de inspiração na mesa (nota 0079): dar, guardar, usar depois de ver a rolagem e o ataque que espera. */

const compendium = loadSrdCompendium();
const GM = { playerId: randomUUID(), displayName: 'Mestre' };
const ANA = { playerId: randomUUID(), displayName: 'Ana' };
const BRUNO = { playerId: randomUUID(), displayName: 'Bruno' };

const applied = (o: IntentOutcome): boolean => o.result.status === 'applied';
const reason = (o: IntentOutcome): string | undefined => (o.result.status === 'rejected' ? o.result.message : undefined);
type Fixture = { character: { baseScores: SessionCharacter['baseScores']; steps: unknown } };

/** Lia (Bardo 6, Ana) e Tordek (Guerreiro 5, Bruno, com espada longa: +7), e um Goblin Warrior (CA 15). Os d20 e dados vêm da fila. */
function table() {
  const queue: number[] = [];
  const session = new HostSession({ id: randomUUID(), name: 'Mina' }, GM, {
    rng: { roll: (sides) => Math.min(sides, queue.shift() ?? 10) },
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
  session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Caverna', width: 30, height: 30 } });
  const mapId = Object.keys(session.state.maps)[0] ?? '';
  const create = (player: typeof ANA, name: string, fixture: unknown, x: number): string => {
    session.handle(player.playerId, { kind: 'character.create', data: { name } });
    const id = Object.values(session.state.characters).find((c) => c.name === name)?.id ?? '';
    const { character } = fixture as Fixture;
    session.handle(player.playerId, { kind: 'character.update', data: { characterId: id, baseScores: character.baseScores ?? undefined, steps: CharacterSchema.shape.steps.parse(character.steps) } });
    session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name, position: { x, y: 0 }, size: 'medium', characterId: id, ownerIds: [player.playerId] } });
    return id;
  };
  const bard = create(ANA, 'Lia', halflingBard, 0);
  const fighter = create(BRUNO, 'Tordek', dwarfFighter, 100);
  session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Goblin', position: { x: 200, y: 0 }, size: 'small', monsterId: 'goblin_warrior' } });
  const token = (name: string) => Object.values(session.state.tokens).find((t) => t.name === name)?.id ?? '';
  const character = (id: string): SessionCharacter => session.state.characters[id] as SessionCharacter;
  session.handle(BRUNO.playerId, { kind: 'inventory.add', data: { characterId: fighter, itemId: 'longsword' } });
  const sword = character(fighter).inventory.items.find((e) => e.itemId === 'longsword')?.instanceId ?? '';
  session.handle(BRUNO.playerId, { kind: 'inventory.update', data: { characterId: fighter, instanceId: sword, equipped: true } });
  const inspire = (target = token('Tordek'), player = ANA) => session.handle(player.playerId, { kind: 'feature.use', data: { characterId: bard, featureId: 'bardic_inspiration', targetTokenId: target } });
  const attack = (...rolls: number[]) => {
    queue.push(...rolls);
    return session.handle(BRUNO.playerId, { kind: 'attack.make', data: { attacker: { characterId: fighter, instanceId: sword }, targetTokenId: token('Goblin'), visibility: 'public' } });
  };
  const pending = () => Object.values(session.state.pendingAttacks);
  const last = <K extends ChatEntry['kind']>(kind: K) => session.state.chat.findLast((e): e is Extract<ChatEntry, { kind: K }> => e.kind === kind);
  const valid = () => SessionStateSchema.safeParse(session.state).success;
  return { session, queue, bard, fighter, sword, token, character, inspire, attack, pending, last, valid, create };
}

describe('HostSession: Bardic Inspiration (note 0079)', () => {
  it('the Bard gives a d8 to another character, who keeps one at a time', () => {
    const t = table();
    expect(applied(t.inspire())).toBe(true);
    expect(t.character(t.bard).resourcesSpent['bardic_inspiration']).toBe(1);
    expect(t.character(t.fighter).inspiration).toEqual({ dice: '1d8', name: 'Bardic Inspiration', giverId: t.bard, giverName: 'Lia' });
    expect(t.last('feature_used')?.notes).toContain('Tordek recebe um dado de Bardic Inspiration (1d8)');
    expect(reason(t.inspire())).toBe('Tordek já tem um dado de Bardic Inspiration');
    expect(t.character(t.bard).resourcesSpent['bardic_inspiration']).toBe(1);
    expect(t.valid()).toBe(true);
  });

  it('only another character: not the Bard, not a monster', () => {
    const t = table();
    expect(reason(t.inspire(t.token('Lia')))).toBe('Bardic Inspiration: inspira outra criatura, não quem usa');
    expect(reason(t.inspire(t.token('Goblin')))).toBe('Bardic Inspiration: escolha o token de outro personagem');
    expect(t.character(t.bard).resourcesSpent['bardic_inspiration']).toBeUndefined();
  });

  it('added to a sheet roll after seeing it, once, by the holder', () => {
    const t = table();
    t.inspire();
    t.queue.push(6);
    t.session.handle(BRUNO.playerId, { kind: 'roll.d20', data: { characterId: t.fighter, target: { kind: 'skill', skill: 'history' }, visibility: 'public' } });
    const roll = t.last('d20_roll');
    // História: INT −1.
    expect(roll?.total).toBe(5);
    const use = { kind: 'inspiration.use' as const, data: { characterId: t.fighter, entryId: roll?.id ?? '' } };
    expect(reason(t.session.handle(ANA.playerId, use))).toBe('Este personagem não é seu');
    t.queue.push(5);
    expect(applied(t.session.handle(BRUNO.playerId, use))).toBe(true);
    expect(t.last('inspiration_roll')).toMatchObject({ entryOf: roll?.id, characterName: 'Tordek', featureName: 'Bardic Inspiration', giverName: 'Lia', dice: '1d8', value: 5, total: 10 });
    expect(t.character(t.fighter).inspiration).toBeNull();
    expect(reason(t.session.handle(BRUNO.playerId, use))).toBe('Esta rolagem já recebeu um dado de inspiração');
    expect(t.valid()).toBe(true);
  });

  it('a missed attack waits: with the die it hits and rolls the damage', () => {
    const t = table();
    t.inspire();
    // d20 3 + 7 = 10 contra CA 15.
    expect(applied(t.attack(3))).toBe(true);
    expect(t.last('attack_roll')).toBeUndefined();
    const [waiting] = t.pending();
    expect(waiting).toMatchObject({ characterName: 'Tordek', targetName: 'Goblin', roll: { natural: 3, total: 10 } });
    // Outros jogadores veem o ataque esperando.
    expect(Object.keys(viewOf(t.session.state, { playerId: ANA.playerId, role: 'player' }).pendingAttacks)).toEqual([waiting?.id]);
    const resolve = { kind: 'attack.resolve' as const, data: { pendingId: waiting?.id ?? '', inspiration: {} } };
    expect(reason(t.session.handle(ANA.playerId, resolve))).toBe('Só quem atacou (ou o mestre) decide');
    // Dado 6: 16 acerta; dano 1d8 = 4, +4.
    t.queue.push(6, 4);
    expect(applied(t.session.handle(BRUNO.playerId, resolve))).toBe(true);
    const entry = t.last('attack_roll');
    expect(entry).toMatchObject({ hit: true, total: 16, dice: [3] });
    expect(entry?.notes).toContain('Bardic Inspiration (Lia): +6 (1d8)');
    expect(entry?.damage?.total).toBeGreaterThan(0);
    expect(t.pending()).toEqual([]);
    expect(t.character(t.fighter).inspiration).toBeNull();
    expect(t.valid()).toBe(true);
  });

  it('accepting the miss keeps the die; without a die the attack does not wait', () => {
    const t = table();
    expect(applied(t.attack(3))).toBe(true);
    expect(t.pending()).toEqual([]);
    expect(t.last('attack_roll')?.hit).toBe(false);
    t.inspire();
    t.attack(4);
    const [waiting] = t.pending();
    expect(applied(t.session.handle(BRUNO.playerId, { kind: 'attack.resolve', data: { pendingId: waiting?.id ?? '' } }))).toBe(true);
    expect(t.last('attack_roll')).toMatchObject({ hit: false, total: 11 });
    expect(t.character(t.fighter).inspiration).not.toBeNull();
  });

  it('a natural 1 misses without waiting, and a hit never waits', () => {
    const t = table();
    t.inspire();
    t.attack(1);
    expect(t.pending()).toEqual([]);
    expect(t.last('attack_roll')?.fumble).toBe(true);
    t.attack(15, 3);
    expect(t.pending()).toEqual([]);
    expect(t.last('attack_roll')?.hit).toBe(true);
    expect(t.character(t.fighter).inspiration).not.toBeNull();
  });

  it('expires at the end of a rest, and can be discarded', () => {
    const t = table();
    t.inspire();
    t.session.handle(GM.playerId, { kind: 'rest.start', data: { kind: 'short', characterIds: [t.bard] } });
    t.session.handle(GM.playerId, { kind: 'rest.finish', data: {} });
    expect(t.character(t.fighter).inspiration).toBeNull();
    expect(t.last('rest')?.notes).toContain('Tordek: o dado de Bardic Inspiration expirou');
    t.inspire();
    expect(applied(t.session.handle(BRUNO.playerId, { kind: 'inspiration.discard', data: { characterId: t.fighter } }))).toBe(true);
    expect(t.character(t.fighter).inspiration).toBeNull();
    expect(t.last('spell_effect_ended')).toMatchObject({ characterName: 'Tordek', effectName: 'Bardic Inspiration', reason: 'removed' });
    expect(reason(t.session.handle(BRUNO.playerId, { kind: 'inspiration.discard', data: { characterId: t.fighter } }))).toBe('Tordek não tem dado de inspiração');
  });

  it('removing the target drops the waiting attack', () => {
    const t = table();
    t.inspire();
    t.attack(3);
    expect(t.pending()).toHaveLength(1);
    t.session.handle(GM.playerId, { kind: 'token.remove', data: { tokenId: t.token('Goblin') } });
    expect(t.pending()).toEqual([]);
    expect(t.valid()).toBe(true);
  });
});

describe('HostSession: Peerless Skill (note 0079)', () => {
  /** O Bardo 6 com o uso próprio por ajuste (Peerless Skill é do nível 14) e uma adaga. */
  function lore() {
    const t = table();
    t.session.handle(GM.playerId, {
      kind: 'adjustment.add',
      data: { characterId: t.bard, name: 'Peerless', effects: [{ type: 'self_inspiration', id: 'peerless_skill', name: 'Peerless Skill', resource: 'bardic_inspiration', dice: '1d10', rolls: ['check', 'attack'], keepOnFailure: true }] },
    });
    t.session.handle(ANA.playerId, { kind: 'inventory.add', data: { characterId: t.bard, itemId: 'dagger' } });
    const dagger = t.character(t.bard).inventory.items.find((e) => e.itemId === 'dagger')?.instanceId ?? '';
    t.session.handle(ANA.playerId, { kind: 'inventory.update', data: { characterId: t.bard, instanceId: dagger, equipped: true } });
    return { ...t, dagger };
  }

  it('spends a use on a sheet check, not on a save', () => {
    const t = lore();
    t.queue.push(5);
    t.session.handle(ANA.playerId, { kind: 'roll.d20', data: { characterId: t.bard, target: { kind: 'skill', skill: 'deception' }, visibility: 'public' } });
    const check = t.last('d20_roll');
    t.queue.push(7);
    expect(applied(t.session.handle(ANA.playerId, { kind: 'inspiration.use', data: { characterId: t.bard, entryId: check?.id ?? '', selfId: 'peerless_skill' } }))).toBe(true);
    expect(t.last('inspiration_roll')).toMatchObject({ featureName: 'Peerless Skill', value: 7, total: (check?.total ?? 0) + 7 });
    expect(t.character(t.bard).resourcesSpent['bardic_inspiration']).toBe(1);
    t.session.handle(ANA.playerId, { kind: 'roll.d20', data: { characterId: t.bard, target: { kind: 'save', ability: 'wis' }, visibility: 'public' } });
    const save = t.last('d20_roll');
    expect(reason(t.session.handle(ANA.playerId, { kind: 'inspiration.use', data: { characterId: t.bard, entryId: save?.id ?? '', selfId: 'peerless_skill' } }))).toBe('Peerless Skill não vale nesta rolagem');
  });

  it('on a waiting attack that still misses, the use is not spent', () => {
    const t = lore();
    // Adaga: DES +2, proficiência +3 = +5; d20 2 → 7 contra CA 15. Dado 3 → 10, ainda erra.
    t.queue.push(2);
    t.session.handle(ANA.playerId, { kind: 'attack.make', data: { attacker: { characterId: t.bard, instanceId: t.dagger }, targetTokenId: t.token('Goblin'), visibility: 'public' } });
    const [waiting] = t.pending();
    t.queue.push(3);
    expect(applied(t.session.handle(ANA.playerId, { kind: 'attack.resolve', data: { pendingId: waiting?.id ?? '', inspiration: { selfId: 'peerless_skill' } } }))).toBe(true);
    expect(t.last('attack_roll')?.hit).toBe(false);
    expect(t.last('attack_roll')?.notes).toContain('Peerless Skill: ainda errou, o uso não foi gasto');
    expect(t.character(t.bard).resourcesSpent['bardic_inspiration']).toBeUndefined();
  });

  it('a secret attack does not wait', () => {
    const t = lore();
    t.queue.push(2);
    t.session.handle(ANA.playerId, { kind: 'attack.make', data: { attacker: { characterId: t.bard, instanceId: t.dagger }, targetTokenId: t.token('Goblin'), visibility: 'gm' } });
    expect(t.pending()).toEqual([]);
    expect(t.last('attack_roll')?.hit).toBe(false);
  });
});

describe('HostSession: saves waiting for the inspiration (note 0080)', () => {
  const waits = (t: ReturnType<typeof table>) => Object.values(t.session.state.pendingInspirations);
  /** Salvaguarda de DES CD 12 contra o Tordek (DES +1): 2d6 de fogo, metade no sucesso. A fila: o dano e depois o d20. */
  const fireball = (t: ReturnType<typeof table>, ...rolls: number[]) => {
    t.queue.push(...rolls);
    return t.session.handle(GM.playerId, {
      kind: 'save.force',
      data: { source: { custom: { name: 'Explosão', ability: 'dex', dc: 12, damage: [{ dice: '2d6', type: 'fire' }], onSuccess: 'half' } }, targetTokenIds: [t.token('Tordek')], visibility: 'public' },
    });
  };

  it('a failed forced save waits; with the die it passes and the GM gets half the damage', () => {
    const t = table();
    t.inspire();
    // Dano 3 + 3 = 6; d20 5 + 1 = 6 contra CD 12.
    expect(applied(fireball(t, 3, 3, 5))).toBe(true);
    const [waiting] = waits(t);
    expect(waiting).toMatchObject({ characterName: 'Tordek', dc: 12, roll: { total: 6 }, wait: { kind: 'save' } });
    expect(t.last('save_roll')?.results[0]?.notes).toContain('Aguardando Tordek decidir se usa a inspiração');
    expect(Object.values(t.session.state.proposals)).toEqual([]);
    expect(Object.keys(viewOf(t.session.state, { playerId: ANA.playerId, role: 'player' }).pendingInspirations)).toEqual([waiting?.id]);
    const resolve = { kind: 'inspiration.save' as const, data: { pendingId: waiting?.id ?? '', inspiration: {} } };
    expect(reason(t.session.handle(ANA.playerId, resolve))).toBe('Este personagem não é seu');
    t.queue.push(6);
    expect(applied(t.session.handle(BRUNO.playerId, resolve))).toBe(true);
    expect(t.last('inspiration_roll')).toMatchObject({ entryOf: t.last('save_roll')?.id, value: 6, total: 12, success: true });
    expect(Object.values(t.session.state.proposals).map((p) => p.amount)).toEqual([3]);
    expect(waits(t)).toEqual([]);
    expect(t.character(t.fighter).inspiration).toBeNull();
    expect(t.valid()).toBe(true);
  });

  it('accepting the failure gives the whole damage and keeps the die; without a die nothing waits', () => {
    const t = table();
    fireball(t, 3, 3, 5);
    expect(waits(t)).toEqual([]);
    expect(Object.values(t.session.state.proposals).map((p) => p.amount)).toEqual([6]);
    t.inspire();
    fireball(t, 2, 2, 5);
    const [waiting] = waits(t);
    expect(applied(t.session.handle(BRUNO.playerId, { kind: 'inspiration.save', data: { pendingId: waiting?.id ?? '' } }))).toBe(true);
    expect(Object.values(t.session.state.proposals).map((p) => p.amount)).toEqual([6, 4]);
    expect(t.character(t.fighter).inspiration).not.toBeNull();
  });

  it('a secret save does not wait', () => {
    const t = table();
    t.inspire();
    t.queue.push(3, 3, 5);
    t.session.handle(GM.playerId, {
      kind: 'save.force',
      data: { source: { custom: { name: 'Explosão', ability: 'dex', dc: 12, damage: [{ dice: '2d6', type: 'fire' }], onSuccess: 'half' } }, targetTokenIds: [t.token('Tordek')], visibility: 'gm' },
    });
    expect(waits(t)).toEqual([]);
  });

  it('Concentration: the failure waits and the die keeps the spell', () => {
    const t = table();
    // Eli (Bardo 6 do Bruno, CON +1) concentrada em Bless, com o dado da Lia.
    const eli = t.create(BRUNO, 'Eli', halflingBard, 300);
    t.inspire(t.token('Eli'));
    expect(applied(t.session.handle(BRUNO.playerId, { kind: 'concentration.set', data: { characterId: eli, spellId: 'bless' } }))).toBe(true);
    // 10 de dano: CD 10; d20 3 + 1 = 4.
    t.queue.push(3);
    t.session.handle(GM.playerId, { kind: 'hp.change', data: { target: { characterId: eli }, change: { kind: 'damage', amount: 10 } } });
    expect(t.last('concentration_save')?.success).toBe(false);
    expect(t.character(eli).concentration?.spellId).toBe('bless');
    const [waiting] = waits(t);
    expect(waiting?.wait).toMatchObject({ kind: 'concentration', spellId: 'bless' });
    t.queue.push(6);
    expect(applied(t.session.handle(BRUNO.playerId, { kind: 'inspiration.save', data: { pendingId: waiting?.id ?? '', inspiration: {} } }))).toBe(true);
    expect(t.last('inspiration_roll')).toMatchObject({ total: 10, success: true });
    expect(t.character(eli).concentration?.spellId).toBe('bless');
  });

  it('Concentration: accepting ends the spell', () => {
    const t = table();
    const eli = t.create(BRUNO, 'Eli', halflingBard, 300);
    t.inspire(t.token('Eli'));
    t.session.handle(BRUNO.playerId, { kind: 'concentration.set', data: { characterId: eli, spellId: 'bless' } });
    t.queue.push(3);
    t.session.handle(GM.playerId, { kind: 'hp.change', data: { target: { characterId: eli }, change: { kind: 'damage', amount: 10 } } });
    const [waiting] = waits(t);
    t.session.handle(BRUNO.playerId, { kind: 'inspiration.save', data: { pendingId: waiting?.id ?? '' } });
    expect(t.character(eli).concentration).toBeNull();
  });

  it('Death Saving Throw: a simple failure waits, and the die turns it into a success', () => {
    const t = table();
    t.inspire();
    t.session.handle(GM.playerId, { kind: 'hp.change', data: { target: { characterId: t.fighter }, change: { kind: 'damage', amount: 54 } } });
    const roll = () => t.session.handle(BRUNO.playerId, { kind: 'roll.d20', data: { characterId: t.fighter, target: { kind: 'death_save' }, visibility: 'public' } });
    t.queue.push(6);
    expect(applied(roll())).toBe(true);
    expect(t.last('death_save')).toBeUndefined();
    const [waiting] = waits(t);
    expect(waiting).toMatchObject({ dc: 10, roll: { natural: 6, total: 6 }, wait: { kind: 'death' } });
    t.queue.push(5);
    expect(applied(t.session.handle(BRUNO.playerId, { kind: 'inspiration.save', data: { pendingId: waiting?.id ?? '', inspiration: {} } }))).toBe(true);
    expect(t.last('death_save')).toMatchObject({ total: 11, outcome: 'success', deathSaves: { successes: 1, failures: 0 } });
    expect(t.last('death_save')?.notes).toContain('Bardic Inspiration (Lia): +5 (1d8)');
    expect(t.valid()).toBe(true);
  });

  it('Death Saving Throw: a natural 1 never waits', () => {
    const t = table();
    t.inspire();
    t.session.handle(GM.playerId, { kind: 'hp.change', data: { target: { characterId: t.fighter }, change: { kind: 'damage', amount: 54 } } });
    t.queue.push(1);
    t.session.handle(BRUNO.playerId, { kind: 'roll.d20', data: { characterId: t.fighter, target: { kind: 'death_save' }, visibility: 'public' } });
    expect(waits(t)).toEqual([]);
    expect(t.last('death_save')?.outcome).toBe('two_failures');
  });

  it('removing the character drops its waiting saves', () => {
    const t = table();
    t.inspire();
    fireball(t, 3, 3, 5);
    expect(waits(t)).toHaveLength(1);
    t.session.handle(BRUNO.playerId, { kind: 'character.remove', data: { characterId: t.fighter } });
    expect(waits(t)).toEqual([]);
    expect(t.valid()).toBe(true);
  });
});
