import { randomUUID } from 'node:crypto';
import { loadSrdCompendium } from 'rules-engine';
import { CharacterSchema } from 'rules-engine/schemas';
import { describe, expect, it } from 'vitest';
import dwarfMonk from '../../../packages/rules-engine/tests/fixtures/dwarf-monk-6.json';
import { type ChatEntry, type Intent, type SessionCharacter, SessionStateSchema } from '../../shared/protocol';
import { characterSheet } from '../character-sheet';
import { HostSession, type IntentOutcome } from './executor';

/** Ataque Desarmado e características usadas no acerto (nota 0083). Monge Open Hand 6: Desarmado +7 (1d8+4), CD 13. */

const compendium = loadSrdCompendium();
const GM = { playerId: randomUUID(), displayName: 'Mestre' };
const ANA = { playerId: randomUUID(), displayName: 'Ana' };

const applied = (o: IntentOutcome): boolean => o.result.status === 'applied';
const reason = (o: IntentOutcome): string | undefined => (o.result.status === 'rejected' ? o.result.message : undefined);

function table() {
  const queue: number[] = [];
  const session = new HostSession({ id: randomUUID(), name: 'Mosteiro' }, GM, {
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
  session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Pátio', width: 20, height: 20 } });
  const mapId = Object.keys(session.state.maps)[0] ?? '';
  session.handle(ANA.playerId, { kind: 'character.create', data: { name: 'Kai' } });
  const id = Object.keys(session.state.characters)[0] ?? '';
  const { character } = dwarfMonk as unknown as { character: { baseScores: SessionCharacter['baseScores']; steps: unknown } };
  session.handle(ANA.playerId, { kind: 'character.update', data: { characterId: id, baseScores: character.baseScores ?? undefined, steps: CharacterSchema.shape.steps.parse(character.steps) } });
  session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Kai', position: { x: 0, y: 0 }, size: 'medium', characterId: id, ownerIds: [ANA.playerId] } });
  session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Goblin', position: { x: 100, y: 0 }, size: 'small', monsterId: 'goblin_warrior' } });
  const tokenId = (name: string) => Object.values(session.state.tokens).find((t) => t.name === name)?.id ?? '';
  const character_ = (): SessionCharacter => session.state.characters[id] as SessionCharacter;
  const last = <K extends ChatEntry['kind']>(kind: K) => session.state.chat.findLast((e): e is Extract<ChatEntry, { kind: K }> => e.kind === kind);
  /** Ataque Desarmado contra o Goblin; devolve o `attack_roll`. */
  const punch = (...rolls: number[]) => {
    queue.push(...rolls);
    session.handle(ANA.playerId, { kind: 'attack.make', data: { attacker: { characterId: id, instanceId: 'unarmed' }, targetTokenId: tokenId('Goblin'), visibility: 'public' } });
    return last('attack_roll');
  };
  const use = (featureId: string, data: Partial<Extract<Intent, { kind: 'feature.use' }>['data']> = {}) => session.handle(ANA.playerId, { kind: 'feature.use', data: { characterId: id, featureId, ...data } });
  const fight = () => session.handle(GM.playerId, { kind: 'combat.start', data: { tokenIds: [tokenId('Kai'), tokenId('Goblin')] } });
  /** Combate com o Monge na vez (iniciativa: d20 20 contra 1). */
  const fightFirst = () => {
    queue.push(20, 1);
    fight();
  };
  const goblin = () => Object.values(session.state.tokens).find((t) => t.name === 'Goblin');
  const valid = () => SessionStateSchema.safeParse(session.state).success;
  return { session, queue, id, tokenId, character: character_, last, punch, use, fightFirst, goblin, valid };
}

describe('HostSession: Unarmed Strike (note 0083)', () => {
  it('the Monk punches with DEX and the Martial Arts die', () => {
    const t = table();
    // d20 10 + 7 = 17 contra CA 15; 1d8 = 5, +4.
    const entry = t.punch(10, 5);
    expect(entry).toMatchObject({ label: 'Unarmed Strike', hit: true, total: 17, weapon: { characterId: t.id, instanceId: 'unarmed' } });
    expect(entry?.damage).toMatchObject({ groups: [{ dice: '1d8', rolls: [{ sides: 8, value: 5 }] }], bonus: 4, total: 9 });
    expect(entry?.mastery).toBeUndefined();
  });
});

describe('HostSession: features used on a hit (note 0083)', () => {
  it('Stunning Strike: on a failure, Stunned until the start of the Monk next turn; once per turn in combat', () => {
    const t = table();
    t.fightFirst();
    const entry = t.punch(10, 5);
    // CON do Goblin Warrior: d20 2 + 0 = 2 contra CD 13.
    t.queue.push(2);
    expect(applied(t.use('stunning_strike', { entryId: entry?.id ?? '' }))).toBe(true);
    expect(t.last('save_roll')).toMatchObject({ label: 'Stunning Strike', ability: 'con', dc: 13 });
    expect(t.goblin()?.conditions.active.map((c) => [c.condition, c.until?.at, c.until?.tokenId])).toEqual([['stunned', 'turn_start', t.tokenId('Kai')]]);
    expect(t.character().resourcesSpent['focus_points']).toBe(1);
    expect(t.last('feature_used')).toMatchObject({ featureId: 'stunning_strike', attackOf: entry?.id });
    const again = t.punch(10, 5);
    expect(reason(t.use('stunning_strike', { entryId: again?.id ?? '' }))).toBe('Stunning Strike: uma vez por turno');
    expect(t.valid()).toBe(true);
  });

  it('Stunning Strike: on a success, the next attack against the target has Advantage', () => {
    const t = table();
    t.fightFirst();
    const entry = t.punch(10, 5);
    t.queue.push(19);
    t.use('stunning_strike', { entryId: entry?.id ?? '' });
    expect(t.goblin()?.conditions.active).toEqual([]);
    expect(t.session.state.combat?.effects).toEqual([expect.objectContaining({ kind: 'stunning', targetTokenId: t.tokenId('Goblin') })]);
    // O próximo ataque contra o Goblin: com Vantagem, e o efeito se gasta.
    const next = t.punch(4, 15, 5);
    expect(next?.advantage).toContain('Stunning Strike (Kai)');
    expect(t.session.state.combat?.effects).toEqual([]);
  });

  it('needs a hit by the character, once per attack, with a Monk weapon or unarmed', () => {
    const t = table();
    const miss = t.punch(2);
    expect(reason(t.use('stunning_strike', { entryId: miss?.id ?? '' }))).toBe('Stunning Strike: só num ataque que acertou');
    expect(reason(t.use('stunning_strike'))).toBe('Stunning Strike: escolha o ataque que acertou');
    expect(reason(t.use('flurry_of_blows', { entryId: miss?.id ?? '' }))).toBe('Flurry of Blows não é usada num ataque');
    const entry = t.punch(10, 5);
    t.queue.push(19);
    expect(applied(t.use('stunning_strike', { entryId: entry?.id ?? '' }))).toBe(true);
    expect(reason(t.use('stunning_strike', { entryId: entry?.id ?? '' }))).toBe('Stunning Strike: já usada neste ataque');
    // Fora do combate, sem o Monge no combate, o sucesso fica com a mesa.
    expect(t.last('feature_used')?.notes).toContain('Fora do combate: a Vantagem no próximo ataque contra o alvo fica com a mesa');
  });

  it('Open Hand Technique: only after Flurry of Blows in the turn, one technique per hit', () => {
    const t = table();
    t.fightFirst();
    const entry = t.punch(10, 5);
    expect(reason(t.use('open_hand_topple', { entryId: entry?.id ?? '' }))).toBe('Open Hand Technique: Topple: só nos ataques do Flurry of Blows neste turno');
    expect(applied(t.use('flurry_of_blows'))).toBe(true);
    expect(t.character().resourcesSpent['focus_points']).toBe(1);
    const flurry = t.punch(10, 5);
    // DES do Goblin Warrior: d20 3 + 2 = 5 contra CD 13.
    t.queue.push(3);
    expect(applied(t.use('open_hand_topple', { entryId: flurry?.id ?? '' }))).toBe(true);
    expect(t.goblin()?.conditions.active.map((c) => c.condition)).toEqual(['prone']);
    expect(reason(t.use('open_hand_addle', { entryId: flurry?.id ?? '' }))).toBe('Open Hand Technique: Addle: já usada neste ataque');
    // Push: só a nota na falha.
    const second = t.punch(10, 5);
    t.queue.push(1);
    expect(applied(t.use('open_hand_push', { entryId: second?.id ?? '' }))).toBe(true);
    expect(t.last('feature_used')?.notes).toContain('Na falha: Empurrado até 15 ft para longe de você');
  });

  it('a damage that some creature types do not take, and a size limit for a condition', () => {
    const t = table();
    t.session.handle(GM.playerId, {
      kind: 'adjustment.add',
      data: {
        characterId: t.id,
        name: 'Teste',
        effects: [
          { type: 'feature_use', id: 'hell', name: 'Inferno', targets: 'one', onHit: { attacks: 'any' }, parts: [{ kind: 'save', ability: 'cha', dc: { ability: 'wis' }, damage: { dice: '8d10', bonus: [], type: 'psychic', exceptTypes: ['fey'] }, onSuccess: 'none', conditions: ['incapacitated'] }] },
          { type: 'feature_use', id: 'trip', name: 'Rasteira', targets: 'one', onHit: { attacks: 'any' }, parts: [{ kind: 'condition', conditions: ['prone'], maxSize: 'tiny' }] },
        ],
      },
    });
    const entry = t.punch(10, 5);
    t.queue.push(1, 1, 1, 1, 1, 1, 1, 1, 2);
    expect(applied(t.use('hell', { entryId: entry?.id ?? '' }))).toBe(true);
    const save = t.last('save_roll');
    expect(save?.results[0]?.success).toBe(false);
    expect(save?.results[0]?.damage).toBeUndefined();
    expect(save?.results[0]?.notes).toContain('Sem o dano (tipo de criatura)');
    expect(t.goblin()?.conditions.active.map((c) => c.condition)).toEqual(['incapacitated']);
    const other = t.punch(10, 5);
    expect(applied(t.use('trip', { entryId: other?.id ?? '' }))).toBe(true);
    expect(t.last('feature_used')?.notes).toContain('Goblin: grande demais para Caído');
  });
});
