import { randomUUID } from 'node:crypto';
import { loadSrdCompendium } from 'rules-engine';
import { CharacterSchema } from 'rules-engine/schemas';
import { describe, expect, it } from 'vitest';
import dragonbornPaladin from '../../../packages/rules-engine/tests/fixtures/dragonborn-paladin-6.json';
import humanCleric from '../../../packages/rules-engine/tests/fixtures/human-cleric-5.json';
import { type ChatEntry, type Intent, type SessionCharacter, SessionStateSchema } from '../../shared/protocol';
import { characterSheet } from '../character-sheet';
import { HostSession, type IntentOutcome } from './executor';

/** Características que forçam salvaguarda na mesa (nota 0082). */

const compendium = loadSrdCompendium();
const GM = { playerId: randomUUID(), displayName: 'Mestre' };
const ANA = { playerId: randomUUID(), displayName: 'Ana' };
const FIXTURES = { cleric: humanCleric, paladin: dragonbornPaladin };

const applied = (o: IntentOutcome): boolean => o.result.status === 'applied';
const reason = (o: IntentOutcome): string | undefined => (o.result.status === 'rejected' ? o.result.message : undefined);

/** O personagem da Ana e monstros no mapa; os dados vêm da fila (10 quando vazia). */
function table(who: keyof typeof FIXTURES, monsters: { name: string; monsterId: string }[]) {
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
  session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Cripta', width: 30, height: 30 } });
  const mapId = Object.keys(session.state.maps)[0] ?? '';
  session.handle(ANA.playerId, { kind: 'character.create', data: { name: 'Lia' } });
  const id = Object.keys(session.state.characters)[0] ?? '';
  const { character } = FIXTURES[who] as unknown as { character: { baseScores: SessionCharacter['baseScores']; steps: unknown } };
  session.handle(ANA.playerId, { kind: 'character.update', data: { characterId: id, baseScores: character.baseScores ?? undefined, steps: CharacterSchema.shape.steps.parse(character.steps) } });
  session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Lia', position: { x: 0, y: 0 }, size: 'medium', characterId: id, ownerIds: [ANA.playerId] } });
  monsters.forEach((m, i) => session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: m.name, position: { x: (i + 1) * 100, y: 0 }, size: 'medium', monsterId: m.monsterId } }));
  const token = (name: string) => Object.values(session.state.tokens).find((t) => t.name === name);
  const tokenId = (name: string) => token(name)?.id ?? '';
  const use = (featureId: string, data: Partial<Extract<Intent, { kind: 'feature.use' }>['data']> = {}) => session.handle(ANA.playerId, { kind: 'feature.use', data: { characterId: id, featureId, ...data } });
  const character_ = (): SessionCharacter => session.state.characters[id] as SessionCharacter;
  const last = <K extends ChatEntry['kind']>(kind: K) => session.state.chat.findLast((e): e is Extract<ChatEntry, { kind: K }> => e.kind === kind);
  const proposals = () => Object.values(session.state.proposals);
  const conditions = (name: string) => token(name)?.conditions.active.map((c) => c.condition) ?? [];
  const valid = () => SessionStateSchema.safeParse(session.state).success;
  return { session, queue, id, token, tokenId, use, character: character_, last, proposals, conditions, valid };
}

describe('HostSession: features with a saving throw (note 0082)', () => {
  it('Breath Weapon: one damage roll for every target, half on a success, proposals for the GM', () => {
    const t = table('paladin', [
      { name: 'Goblin 1', monsterId: 'goblin_warrior' },
      { name: 'Goblin 2', monsterId: 'goblin_warrior' },
    ]);
    // 2d10 = 6 + 4; DES do Goblin Warrior: d20 3 falha, d20 19 passa (CD 13).
    t.queue.push(6, 4, 3, 19);
    expect(applied(t.use('breath_weapon', { targetTokenIds: [t.tokenId('Goblin 1'), t.tokenId('Goblin 2')] }))).toBe(true);
    const save = t.last('save_roll');
    expect(save).toMatchObject({ label: 'Breath Weapon', ability: 'dex', dc: 13, damage: { total: 10 } });
    expect(save?.results.map((r) => [r.targetName, r.success])).toEqual([
      ['Goblin 1', false],
      ['Goblin 2', true],
    ]);
    expect(t.proposals().map((p) => [p.targetName, p.amount])).toEqual([
      ['Goblin 1', 10],
      ['Goblin 2', 5],
    ]);
    expect(t.character().resourcesSpent['breath_weapon']).toBe(1);
    expect(t.valid()).toBe(true);
  });

  it('many targets need a list; a single target feature refuses it', () => {
    const t = table('paladin', [{ name: 'Goblin', monsterId: 'goblin_warrior' }]);
    expect(reason(t.use('breath_weapon'))).toBe('Breath Weapon: escolha os alvos');
    expect(reason(t.use('breath_weapon', { targetTokenIds: [t.tokenId('Goblin'), t.tokenId('Goblin')] }))).toBe('Alvo repetido');
    expect(t.character().resourcesSpent['breath_weapon']).toBeUndefined();
  });

  it('Turn Undead: only Undead roll; failures are Frightened and Incapacitated, with Sear Undead damage that does not end them', () => {
    const t = table('cleric', [
      { name: 'Zumbi', monsterId: 'ghoul' },
      { name: 'Goblin', monsterId: 'goblin_warrior' },
    ]);
    // SAB do Ghoul: d20 2 falha (CD 15); Sear Undead 4d8 = 3 + 3 + 3 + 3.
    t.queue.push(2, 3, 3, 3, 3);
    expect(applied(t.use('turn_undead', { targetTokenIds: [t.tokenId('Zumbi'), t.tokenId('Goblin')] }))).toBe(true);
    expect(t.last('feature_used')?.notes).toContain('Goblin: não é do tipo que a característica afeta');
    expect(t.last('save_roll')?.results.map((r) => r.targetName)).toEqual(['Zumbi']);
    expect(t.conditions('Zumbi')).toEqual(['frightened', 'incapacitated']);
    expect(t.conditions('Goblin')).toEqual([]);
    const sear = t.last('spell_damage');
    expect(sear).toMatchObject({ label: 'Turn Undead', results: [{ targetName: 'Zumbi', total: 12 }] });
    // Aplicar o Sear Undead não acaba o efeito.
    const [proposal] = t.proposals();
    expect(applied(t.session.handle(GM.playerId, { kind: 'damage.apply', data: { proposalId: proposal?.id ?? '' } }))).toBe(true);
    expect(t.conditions('Zumbi')).toEqual(['frightened', 'incapacitated']);
    // Outro dano acaba.
    expect(applied(t.session.handle(GM.playerId, { kind: 'hp.change', data: { target: { tokenId: t.tokenId('Zumbi') }, change: { kind: 'damage', amount: 3 } } }))).toBe(true);
    expect(t.conditions('Zumbi')).toEqual([]);
    expect(t.last('condition_changed')?.notes).toEqual(['Sofreu dano']);
    expect(t.valid()).toBe(true);
  });

  it('Divine Spark: the damage type is chosen, half on a success', () => {
    const t = table('cleric', [{ name: 'Goblin', monsterId: 'goblin_warrior' }]);
    expect(reason(t.use('divine_spark_damage', { targetTokenId: t.tokenId('Goblin') }))).toBe('Divine Spark (dano): escolha o tipo de dano');
    expect(reason(t.use('divine_spark_damage', { targetTokenId: t.tokenId('Goblin'), damageType: 'fire' }))).toBe('Divine Spark (dano) não deixa escolher esse tipo de dano');
    // 1d8+4 = 6 + 4; CON do Goblin Warrior: d20 18 passa (CD 15).
    t.queue.push(6, 18);
    expect(applied(t.use('divine_spark_damage', { targetTokenId: t.tokenId('Goblin'), damageType: 'radiant' }))).toBe(true);
    expect(t.last('save_roll')?.damage?.groups[0]?.type).toBe('radiant');
    expect(t.proposals().map((p) => p.amount)).toEqual([5]);
    expect(t.character().resourcesSpent['channel_divinity']).toBe(1);
  });

  it('maxTargets limits the list', () => {
    const t = table('cleric', [
      { name: 'A', monsterId: 'goblin_warrior' },
      { name: 'B', monsterId: 'goblin_warrior' },
    ]);
    t.session.handle(GM.playerId, {
      kind: 'adjustment.add',
      data: { characterId: t.id, name: 'Teste', effects: [{ type: 'feature_use', id: 'scare', name: 'Susto', targets: 'many', maxTargets: 1, parts: [{ kind: 'save', ability: 'wis', dc: { ability: 'cha' }, onSuccess: 'none', conditions: ['frightened'], endsOnDamage: true }] }] },
    });
    expect(reason(t.use('scare', { targetTokenIds: [t.tokenId('A'), t.tokenId('B')] }))).toBe('Susto: no máximo 1 alvo(s)');
    t.queue.push(1);
    expect(applied(t.use('scare', { targetTokenIds: [t.tokenId('A')] }))).toBe(true);
    expect(t.token('A')?.conditions.active).toEqual([{ condition: 'frightened', endsOnDamage: { entryId: t.last('feature_used')?.id } }]);
  });
});
