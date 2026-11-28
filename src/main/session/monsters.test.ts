import { randomUUID } from 'node:crypto';
import { loadSrdCompendium } from 'rules-engine';
import { describe, expect, it } from 'vitest';
import { SessionStateSchema } from '../../shared/protocol';
import { HostSession, type IntentOutcome } from './executor';

/** Usos limitados e recarga dos monstros (nota 0064). */

const compendium = loadSrdCompendium();
const GM = { playerId: randomUUID(), displayName: 'Mestre' };
const ANA = { playerId: randomUUID(), displayName: 'Ana' };
const applied = (o: IntentOutcome): boolean => o.result.status === 'applied';
const rejection = (o: IntentOutcome): string | undefined => (o.result.status === 'rejected' ? o.result.code : undefined);

/** Dragão vermelho adulto (Fire Breath com recarga 5–6, Resistência Lendária 3/dia) e um goblin. */
function table(rolls: number[]) {
  let i = 0;
  const session = new HostSession({ id: randomUUID(), name: 'Mesa' }, GM, {
    rng: { roll: () => rolls[i++ % rolls.length] ?? 1 },
    now: () => 1763769600000,
    newId: randomUUID,
    monsterExists: (id) => compendium.creatures.some((c) => c.id === id),
    assetExists: () => false,
    pruneSteps: (steps) => steps,
    itemProblems: () => [],
    characterSheet: () => undefined,
    monsterHpMax: (id) => compendium.creatures.find((c) => c.id === id)?.hp.average,
    creature: (id) => compendium.creatures.find((c) => c.id === id),
    item: () => undefined,
    spell: (id) => compendium.spells.find((s) => s.id === id),
  });
  session.connect(ANA);
  session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Covil', width: 20, height: 20 } });
  const mapId = Object.keys(session.state.maps)[0] ?? '';
  session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Dragão', position: { x: 0, y: 0 }, size: 'huge', monsterId: 'adult_red_dragon' } });
  session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Goblin', position: { x: 1000, y: 0 }, size: 'small', monsterId: 'goblin_warrior' } });
  const id = (name: string) => Object.values(session.state.tokens).find((t) => t.name === name)?.id ?? '';
  const dragon = id('Dragão');
  const goblin = id('Goblin');
  const breath = () => session.handle(GM.playerId, { kind: 'save.force', data: { source: { tokenId: dragon, actionId: 'fire_breath' }, targetTokenIds: [goblin], visibility: 'public' } });
  const use = (playerId: string, featureId: string, change: 'spend' | 'restore') => session.handle(playerId, { kind: 'monster.use', data: { tokenId: dragon, featureId, change } });
  const spent = () => session.state.tokens[dragon]?.uses.spent;
  return { session, dragon, goblin, breath, use, spent };
}

describe('HostSession: monster limited uses (note 0064)', () => {
  it('spends the breath, refuses it while spent and lets the GM restore it', () => {
    const t = table([3]);
    expect(applied(t.breath())).toBe(true);
    expect(t.spent()).toEqual({ fire_breath: 1 });
    expect(rejection(t.breath())).toBe('rule_violation');
    expect(applied(t.use(GM.playerId, 'fire_breath', 'restore'))).toBe(true);
    expect(rejection(t.use(GM.playerId, 'fire_breath', 'restore'))).toBe('rule_violation');
    expect(applied(t.breath())).toBe(true);
    expect(SessionStateSchema.safeParse(t.session.state).success).toBe(true);
  });

  it('does not spend anything when an attack has no limit', () => {
    const t = table([10]);
    expect(applied(t.session.handle(GM.playerId, { kind: 'attack.make', data: { attacker: { tokenId: t.dragon, actionId: 'rend' }, targetTokenId: t.goblin, visibility: 'public' } }))).toBe(true);
    expect(t.spent()).toEqual({});
  });

  it('counts uses per day by hand, with the lair limit, and gives all back on a rest', () => {
    const t = table([1]);
    for (let i = 0; i < 3; i++) expect(applied(t.use(GM.playerId, 'legendary_resistance', 'spend'))).toBe(true);
    expect(rejection(t.use(GM.playerId, 'legendary_resistance', 'spend'))).toBe('rule_violation');
    t.session.handle(GM.playerId, { kind: 'monster.lair', data: { tokenId: t.dragon, lair: true } });
    expect(applied(t.use(GM.playerId, 'legendary_resistance', 'spend'))).toBe(true);
    expect(rejection(t.use(GM.playerId, 'rend', 'spend'))).toBe('rule_violation');
    t.session.handle(GM.playerId, { kind: 'monster.rest', data: { tokenId: t.dragon } });
    expect(t.session.state.tokens[t.dragon]?.uses).toEqual({ spent: {}, lair: true });
  });

  it('only the GM and the token owners change the uses; players do not see them', () => {
    const t = table([3]);
    expect(rejection(t.use(ANA.playerId, 'fire_breath', 'spend'))).toBe('not_allowed');
    expect(rejection(t.session.handle(ANA.playerId, { kind: 'monster.rest', data: { tokenId: t.dragon } }))).toBe('not_allowed');
    const { change } = t.use(GM.playerId, 'fire_breath', 'spend');
    if (!change) throw new Error('sem mudança');
    expect(t.session.patchFor(change, ANA.playerId).ops).toEqual([]);
    expect(t.session.viewFor(ANA.playerId).tokens[t.dragon]?.uses).toEqual({ spent: {}, lair: false });
    expect(t.session.viewFor(GM.playerId).tokens[t.dragon]?.uses.spent).toEqual({ fire_breath: 1 });
  });

  it('rolls the recharge at the start of the turn, hidden from the players', () => {
    const rolls = [1];
    const t = table(rolls);
    t.use(GM.playerId, 'fire_breath', 'spend');
    t.session.handle(GM.playerId, { kind: 'combat.start', data: { tokenIds: [t.dragon, t.goblin] } });
    // Uma volta inteira com 1: continua gasta; com 6, volta.
    const round = () => {
      t.session.handle(GM.playerId, { kind: 'combat.next', data: {} });
      t.session.handle(GM.playerId, { kind: 'combat.next', data: {} });
    };
    round();
    expect(t.spent()).toEqual({ fire_breath: 1 });
    rolls[0] = 6;
    round();
    expect(t.spent()).toEqual({});
    const entry = t.session.state.chat.findLast((e) => e.kind === 'recharge_roll');
    expect(entry).toMatchObject({ actionName: 'Fire Breath', roll: 6, min: 5 });
    expect(t.session.viewFor(ANA.playerId).chat.find((e) => e.id === entry?.id)?.kind).toBe('hidden_roll');
    const count = t.session.state.chat.filter((e) => e.kind === 'recharge_roll').length;
    round();
    expect(t.session.state.chat.filter((e) => e.kind === 'recharge_roll')).toHaveLength(count);
  });

  it('a monster at 0 hit points does not recharge', () => {
    const t = table([6]);
    t.use(GM.playerId, 'fire_breath', 'spend');
    t.session.handle(GM.playerId, { kind: 'hp.change', data: { target: { tokenId: t.dragon }, change: { kind: 'damage', amount: 999 } } });
    t.session.handle(GM.playerId, { kind: 'combat.start', data: { tokenIds: [t.dragon] } });
    expect(t.spent()).toEqual({ fire_breath: 1 });
  });
});

describe('HostSession: conditions imposed by monster actions (note 0065)', () => {
  /** Um monstro que ataca um goblin (Small) e um dragão (Huge), com dados fixos. */
  function arena(monsterId: string, rolls: number[]) {
    const t = table(rolls);
    const mapId = t.session.state.activeMapId ?? '';
    t.session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Monstro', position: { x: 1100, y: 0 }, size: 'medium', monsterId } });
    const monster = Object.values(t.session.state.tokens).find((x) => x.name === 'Monstro')?.id ?? '';
    const attack = (actionId: string, target: string) => t.session.handle(GM.playerId, { kind: 'attack.make', data: { attacker: { tokenId: monster, actionId }, targetTokenId: target, visibility: 'public' } });
    const force = (actionId: string, target: string) => t.session.handle(GM.playerId, { kind: 'save.force', data: { source: { tokenId: monster, actionId }, targetTokenIds: [target], visibility: 'public' } });
    const active = (id: string) => t.session.state.tokens[id]?.conditions.active ?? [];
    return { ...t, monster, attack, force, active };
  }

  it('a hit knocks the target Prone, within the size limit', () => {
    const a = arena('wolf', [20]);
    expect(applied(a.attack('bite', a.goblin))).toBe(true);
    expect(a.active(a.goblin)).toEqual([{ condition: 'prone' }]);
    expect(a.session.state.chat.findLast((e) => e.kind === 'attack_roll')).toMatchObject({ notes: ['No acerto: Caído'] });
    a.attack('bite', a.dragon);
    expect(a.active(a.dragon)).toEqual([]);
    expect(a.session.state.chat.findLast((e) => e.kind === 'attack_roll')).toMatchObject({ notes: ['No acerto: Grande demais para a condição'] });
  });

  it('a miss and a successful save impose nothing', () => {
    const a = arena('wolf', [1]);
    a.attack('bite', a.goblin);
    expect(a.active(a.goblin)).toEqual([]);
    const s = arena('lion', [20]);
    s.force('roar', s.goblin);
    expect(s.active(s.goblin)).toEqual([]);
  });

  it('Restrained goes away with the grapple', () => {
    const a = arena('crocodile', [20]);
    a.attack('bite', a.goblin);
    expect(a.active(a.goblin)).toEqual([{ condition: 'grappled' }, { condition: 'restrained', with: 'grappled' }]);
    a.session.handle(GM.playerId, { kind: 'condition.remove', data: { target: { tokenId: a.goblin }, condition: 'grappled' } });
    expect(a.active(a.goblin)).toEqual([]);
    expect(a.session.state.chat.at(-1)).toMatchObject({ kind: 'condition_changed', notes: ['Também acabou: Impedido'] });
    expect(SessionStateSchema.safeParse(a.session.state).success).toBe(true);
  });

  it('a target already Grappled by something else is not tied to the new grapple', () => {
    const a = arena('crocodile', [20]);
    a.session.handle(GM.playerId, { kind: 'condition.add', data: { target: { tokenId: a.goblin }, condition: 'grappled' } });
    a.attack('bite', a.goblin);
    expect(a.active(a.goblin)).toEqual([{ condition: 'grappled' }]);
  });

  it('a failed save imposes the condition until the turn of the monster; without combat, a note', () => {
    const a = arena('lion', [1]);
    a.force('roar', a.goblin);
    expect(a.active(a.goblin)).toEqual([{ condition: 'frightened' }]);
    expect(a.session.state.chat.findLast((e) => e.kind === 'save_roll')).toMatchObject({ results: [{ notes: ['Na falha: Amedrontado', 'Na falha: Sem Monstro no combate: a duração por turno fica com o mestre'] }] });
    a.session.handle(GM.playerId, { kind: 'condition.remove', data: { target: { tokenId: a.goblin }, condition: 'frightened' } });
    a.session.handle(GM.playerId, { kind: 'combat.start', data: { tokenIds: [a.monster, a.goblin] } });
    a.force('roar', a.goblin);
    expect(a.active(a.goblin)).toMatchObject([{ condition: 'frightened', until: { at: 'turn_start', tokenId: a.monster } }]);
    for (let i = 0; i < 2; i++) a.session.handle(GM.playerId, { kind: 'combat.next', data: {} });
    expect(a.active(a.goblin)).toEqual([]);
  });
});

describe('HostSession: Multiattack (note 0066)', () => {
  function setupMulti(monsterId: string, rolls: number[]) {
    const t = table(rolls);
    const mapId = t.session.state.activeMapId ?? '';
    t.session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Monstro', position: { x: 1100, y: 0 }, size: 'large', monsterId } });
    const monster = Object.values(t.session.state.tokens).find((x) => x.name === 'Monstro')?.id ?? '';
    const multi = (steps: { actionId: string; targetTokenIds: string[]; advantage?: boolean }[], playerId = GM.playerId, option = 0) =>
      t.session.handle(playerId, { kind: 'attack.multi', data: { tokenId: monster, option, steps, visibility: 'public' } });
    const attacks = () => t.session.state.chat.filter((e) => e.kind === 'attack_roll');
    return { ...t, monster, multi, attacks };
  }

  it('rolls every attack in one change, each with its target and its proposal', () => {
    const t = setupMulti('pit_fiend', [19]);
    const rev = t.session.rev;
    const outcome = t.multi([
      { actionId: 'bite', targetTokenIds: [t.goblin] },
      { actionId: 'devilish_claw', targetTokenIds: [t.goblin], advantage: true },
      { actionId: 'fiery_mace', targetTokenIds: [t.dragon] },
    ]);
    expect(applied(outcome)).toBe(true);
    expect(t.session.rev).toBe(rev + 1);
    expect(t.attacks().map((e) => [e.label, e.targetName, e.mode])).toEqual([
      ['Bite', 'Goblin', 'normal'],
      ['Devilish Claw', 'Goblin', 'advantage'],
      ['Fiery Mace', 'Dragão', 'normal'],
    ]);
    expect(Object.keys(t.session.state.proposals)).toHaveLength(3);
    expect(SessionStateSchema.safeParse(t.session.state).success).toBe(true);
  });

  it('a later attack sees what the earlier one did (Prone)', () => {
    const t = setupMulti('brown_bear', [19]);
    t.multi([
      { actionId: 'claw', targetTokenIds: [t.goblin] },
      { actionId: 'bite', targetTokenIds: [t.goblin] },
    ]);
    const [claw, bite] = t.attacks();
    expect(claw?.mode).toBe('normal');
    expect(bite).toMatchObject({ mode: 'advantage', advantage: ['Caído'] });
  });

  it('spends limited actions and refuses everything when one is spent', () => {
    const t = setupMulti('chimera', [10]);
    const steps = [
      { actionId: 'ram', targetTokenIds: [t.goblin] },
      { actionId: 'fire_breath', targetTokenIds: [t.goblin, t.dragon] },
    ];
    expect(applied(t.multi(steps))).toBe(true);
    expect(t.session.state.tokens[t.monster]?.uses.spent).toEqual({ fire_breath: 1 });
    expect(t.session.state.chat.findLast((e) => e.kind === 'save_roll')).toMatchObject({ results: [{ targetName: 'Goblin' }, { targetName: 'Dragão' }] });
    const before = t.session.state;
    expect(rejection(t.multi(steps))).toBe('rule_violation');
    expect(t.session.state).toBe(before);
  });

  it('refuses what does not fit, repeated or extra targets, and other players', () => {
    const t = setupMulti('chimera', [10]);
    expect(rejection(t.multi([{ actionId: 'bite', targetTokenIds: [t.goblin] }, { actionId: 'bite', targetTokenIds: [t.goblin] }]))).toBe('rule_violation');
    expect(rejection(t.multi([{ actionId: 'bite', targetTokenIds: [t.goblin, t.dragon] }]))).toBe('rule_violation');
    expect(rejection(t.multi([{ actionId: 'fire_breath', targetTokenIds: [t.goblin, t.goblin] }]))).toBe('rule_violation');
    expect(rejection(t.multi([{ actionId: 'bite', targetTokenIds: [t.goblin] }], ANA.playerId))).toBe('not_allowed');
    expect(t.attacks()).toEqual([]);
    expect(rejection(setupMulti('hydra', [10]).multi([{ actionId: 'bite', targetTokenIds: [t.goblin] }]))).toBe('rule_violation');
  });
});

describe('HostSession: monster spells (note 0067)', () => {
  function setupCaster(monsterId: string, rolls: number[]) {
    const t = table(rolls);
    const mapId = t.session.state.activeMapId ?? '';
    t.session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Conjurador', position: { x: 1100, y: 0 }, size: 'medium', monsterId } });
    const caster = Object.values(t.session.state.tokens).find((x) => x.name === 'Conjurador')?.id ?? '';
    const cast = (spellId: string, playerId = GM.playerId) => t.session.handle(playerId, { kind: 'monster.cast', data: { tokenId: caster, spellId } });
    const entry = () => {
      const e = t.session.state.chat.findLast((x) => x.kind === 'spell_cast');
      if (e?.kind !== 'spell_cast') throw new Error('sem magia');
      return e;
    };
    const use = (targetTokenIds: string[], extra: { option?: number } = {}, playerId = GM.playerId) =>
      t.session.handle(playerId, { kind: 'spell.effect', data: { entryId: entry().id, part: 0, targetTokenIds, ...extra } });
    return { ...t, caster, cast, entry, use };
  }

  it('casts at the level of the block, with its DC, and spends the uses per day', () => {
    const t = setupCaster('mage', [3]);
    expect(applied(t.cast('fireball'))).toBe(true);
    expect(t.entry()).toMatchObject({ tokenId: t.caster, characterName: 'Conjurador', notes: ['Conjurada em círculo maior (4º)'], effect: { saveDc: 14, parts: [{ damage: [{ dice: '9d6', type: 'fire' }] }] } });
    expect(t.entry().characterId).toBeUndefined();
    expect(applied(t.cast('fireball'))).toBe(true);
    expect(rejection(t.cast('fireball'))).toBe('rule_violation');
    expect(t.session.state.tokens[t.caster]?.uses.spent).toEqual({ spell_fireball: 2 });
    t.session.handle(GM.playerId, { kind: 'monster.use', data: { tokenId: t.caster, featureId: 'spell_fireball', change: 'restore' } });
    expect(applied(t.cast('fireball'))).toBe(true);
    // À vontade não gasta; magia fora do bloco é recusada.
    expect(applied(t.cast('detect_magic'))).toBe(true);
    expect(t.entry().effect).toBeUndefined();
    expect(rejection(t.cast('wish'))).toBe('rule_violation');
    expect(SessionStateSchema.safeParse(t.session.state).success).toBe(true);
  });

  it('forces the saves of the targets, with the damage as proposals', () => {
    const t = setupCaster('mage', [3]);
    t.cast('fireball');
    expect(applied(t.use([t.goblin, t.dragon]))).toBe(true);
    const save = t.session.state.chat.findLast((e) => e.kind === 'save_roll');
    expect(save).toMatchObject({ actorName: 'Conjurador', dc: 14, results: [{ targetName: 'Goblin', success: false }, { targetName: 'Dragão' }] });
    expect(Object.values(t.session.state.proposals).map((p) => p.targetName)).toEqual(['Goblin']);
    expect(rejection(t.use([t.goblin]))).toBe('rule_violation');
  });

  it('attacks with the bonus of the block, derived from the DC when it is missing', () => {
    const red = setupCaster('adult_red_dragon', [10]);
    red.cast('scorching_ray');
    red.use([red.goblin]);
    expect(red.session.state.chat.findLast((e) => e.kind === 'attack_roll')).toMatchObject({ attackerName: 'Conjurador', modifier: 12, total: 22 });
    const brass = setupCaster('adult_brass_dragon', [10]);
    brass.cast('scorching_ray');
    const effect = brass.entry().effect;
    expect(effect?.attackBonus).toBe((effect?.saveDc ?? 0) - 8);
  });

  it('links the effects to the token that cast it', () => {
    const t = setupCaster('mage', [10]);
    t.cast('invisibility');
    expect(applied(t.use([t.caster]))).toBe(true);
    expect(t.session.state.tokens[t.caster]?.conditions.active).toEqual([{ condition: 'invisible', spell: { tokenId: t.caster, spellId: 'invisibility' } }]);
    expect(SessionStateSchema.safeParse(t.session.state).success).toBe(true);
  });

  it('only the GM and the token owners cast and use it', () => {
    const t = setupCaster('mage', [3]);
    expect(rejection(t.cast('fireball', ANA.playerId))).toBe('not_allowed');
    t.cast('fireball');
    expect(rejection(t.use([t.goblin], {}, ANA.playerId))).toBe('not_allowed');
    // Os usos não aparecem para os jogadores.
    expect(t.session.viewFor(ANA.playerId).tokens[t.caster]?.uses.spent).toEqual({});
  });
});

describe('HostSession: monster concentration (note 0068)', () => {
  /** Um Mage invisível (Concentração) com dados fixos. */
  function concentrating(rolls: number[]) {
    const t = table(rolls);
    const mapId = t.session.state.activeMapId ?? '';
    t.session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Mago', position: { x: 1100, y: 0 }, size: 'medium', monsterId: 'mage' } });
    const mage = Object.values(t.session.state.tokens).find((x) => x.name === 'Mago')?.id ?? '';
    const cast = (spellId: string) => t.session.handle(GM.playerId, { kind: 'monster.cast', data: { tokenId: mage, spellId } });
    const use = (targets: string[]) => {
      const entry = t.session.state.chat.findLast((e) => e.kind === 'spell_cast');
      return t.session.handle(GM.playerId, { kind: 'spell.effect', data: { entryId: entry?.id ?? '', part: 0, targetTokenIds: targets } });
    };
    cast('invisibility');
    use([t.goblin]);
    const token = () => t.session.state.tokens[mage];
    const goblin = () => t.session.state.tokens[t.goblin]?.conditions.active ?? [];
    const hurt = (amount: number) => t.session.handle(GM.playerId, { kind: 'hp.change', data: { target: { tokenId: mage }, change: { kind: 'damage', amount } } });
    return { ...t, mage, cast, use, token, goblinConditions: goblin, hurt };
  }

  it('starts with the cast and a new spell replaces it, ending what it kept', () => {
    const t = concentrating([10]);
    expect(t.token()?.concentration).toEqual({ spellId: 'invisibility', name: 'Invisibility' });
    expect(t.goblinConditions()).toHaveLength(1);
    t.cast('fly');
    expect(t.token()?.concentration?.spellId).toBe('fly');
    expect(t.goblinConditions()).toEqual([]);
    expect(t.session.state.chat.some((e) => e.kind === 'concentration' && e.reason === 'replaced' && e.tokenId === t.mage)).toBe(true);
    expect(SessionStateSchema.safeParse(t.session.state).success).toBe(true);
  });

  it('damage forces a Constitution save: kept on a success, ended on a failure', () => {
    const rolls = [20];
    const t = concentrating(rolls);
    t.hurt(4);
    expect(t.session.state.chat.findLast((e) => e.kind === 'concentration_save')).toMatchObject({ tokenId: t.mage, dc: 10, success: true });
    expect(t.token()?.concentration).not.toBeNull();
    rolls[0] = 1;
    t.hurt(4);
    expect(t.token()?.concentration).toBeNull();
    expect(t.goblinConditions()).toEqual([]);
    expect(t.session.state.chat.findLast((e) => e.kind === 'concentration')).toMatchObject({ event: 'ended', reason: 'failed_save' });
  });

  it('marked dead by the GM, at 0 HP or by Exhaustion 6, it ends once', () => {
    const ends = (t: ReturnType<typeof concentrating>): number => t.session.state.chat.filter((e) => e.kind === 'concentration' && e.event === 'ended').length;
    const byGm = concentrating([20]);
    byGm.session.handle(GM.playerId, { kind: 'token.dead', data: { tokenId: byGm.mage, dead: true } });
    const byDamage = concentrating([20]);
    byDamage.hurt(999);
    const byExhaustion = concentrating([20]);
    byExhaustion.session.handle(GM.playerId, { kind: 'exhaustion.set', data: { target: { tokenId: byExhaustion.mage }, level: 6 } });
    for (const t of [byGm, byDamage, byExhaustion]) {
      expect(t.token()).toMatchObject({ dead: true, concentration: null });
      expect(t.goblinConditions()).toEqual([]);
      expect(ends(t)).toBe(1);
    }
  });

  it('healing does not roll; 0 hit points and Incapacitated end it', () => {
    const t = concentrating([20]);
    t.session.handle(GM.playerId, { kind: 'hp.change', data: { target: { tokenId: t.mage }, change: { kind: 'healing', amount: 5 } } });
    expect(t.session.state.chat.some((e) => e.kind === 'concentration_save')).toBe(false);
    t.hurt(999);
    expect(t.token()?.concentration).toBeNull();
    expect(t.session.state.chat.findLast((e) => e.kind === 'concentration')).toMatchObject({ reason: 'dead' });

    const s = concentrating([20]);
    s.session.handle(GM.playerId, { kind: 'condition.add', data: { target: { tokenId: s.mage }, condition: 'stunned' } });
    expect(s.token()?.concentration).toBeNull();
    expect(s.token()?.conditions.active).toEqual([{ condition: 'stunned' }]);
    expect(s.goblinConditions()).toEqual([]);
    expect(rejection(s.cast('fly'))).toBe('rule_violation');
  });

  it('keeps the new condition when the spell was on the caster itself', () => {
    const t = concentrating([20]);
    t.use([t.mage]);
    t.session.handle(GM.playerId, { kind: 'condition.add', data: { target: { tokenId: t.mage }, condition: 'stunned' } });
    expect(t.token()?.conditions.active).toEqual([{ condition: 'stunned' }]);
  });

  it('the GM ends it, the parts stop working, and removing the token ends what it kept', () => {
    const t = concentrating([20]);
    expect(rejection(t.session.handle(ANA.playerId, { kind: 'concentration.end', data: { tokenId: t.mage } }))).toBe('not_allowed');
    expect(applied(t.session.handle(GM.playerId, { kind: 'concentration.end', data: { tokenId: t.mage } }))).toBe(true);
    expect(t.goblinConditions()).toEqual([]);
    expect(rejection(t.use([t.goblin]))).toBe('rule_violation');
    expect(rejection(t.session.handle(GM.playerId, { kind: 'concentration.end', data: { tokenId: t.mage } }))).toBe('rule_violation');

    const r = concentrating([20]);
    expect(applied(r.session.handle(GM.playerId, { kind: 'token.remove', data: { tokenId: r.mage } }))).toBe(true);
    expect(r.goblinConditions()).toEqual([]);
  });

  it('the damage of a proposal also counts', () => {
    const t = concentrating([1]);
    const rend = t.session.handle(GM.playerId, { kind: 'save.force', data: { source: { tokenId: t.dragon, actionId: 'fire_breath' }, targetTokenIds: [t.mage], visibility: 'public' } });
    expect(applied(rend)).toBe(true);
    const proposalId = Object.keys(t.session.state.proposals)[0] ?? '';
    t.session.handle(GM.playerId, { kind: 'damage.apply', data: { proposalId, amount: 30 } });
    expect(t.session.state.chat.findLast((e) => e.kind === 'concentration_save')).toMatchObject({ dc: 15, success: false });
    expect(t.token()?.concentration).toBeNull();
  });

  it('a spell replaces an attack of the Multiattack, with its targets in the chat', () => {
    const t = table([10]);
    const multi = (steps: { actionId: string; targetTokenIds: string[] }[]) => t.session.handle(GM.playerId, { kind: 'attack.multi', data: { tokenId: t.dragon, option: 0, steps, visibility: 'public' } });
    expect(rejection(multi([{ actionId: 'spell_scorching_ray', targetTokenIds: [t.goblin] }]))).toBe('rule_violation');
    expect(applied(multi([{ actionId: 'rend', targetTokenIds: [t.goblin] }, { actionId: 'spell_scorching_ray', targetTokenIds: [] }]))).toBe(true);
    expect(t.session.state.chat.slice(-2).map((e) => e.kind)).toEqual(['attack_roll', 'spell_cast']);
    expect(rejection(multi([{ actionId: 'rend', targetTokenIds: [] }]))).toBe('rule_violation');
  });
});

describe('HostSession: legendary actions (note 0069)', () => {
  const setup = (rolls: number[]) => {
    const t = table(rolls);
    const legendary = (actionId: string, steps: { actionId: string; targetTokenIds: string[] }[]) =>
      t.session.handle(GM.playerId, { kind: 'attack.multi', data: { tokenId: t.dragon, actionId, option: 0, steps, visibility: 'public' } });
    return { ...t, legendary };
  };

  it('spends a use per round; once-per-turn actions are refused until the turn starts', () => {
    const t = setup([10]);
    expect(applied(t.legendary('pounce', [{ actionId: 'rend', targetTokenIds: [t.goblin] }]))).toBe(true);
    expect(applied(t.legendary('fiery_rays', [{ actionId: 'spell_scorching_ray', targetTokenIds: [] }]))).toBe(true);
    expect(t.spent()).toEqual({ legendary_actions: 2, fiery_rays: 1 });
    expect(rejection(t.legendary('fiery_rays', [{ actionId: 'spell_scorching_ray', targetTokenIds: [] }]))).toBe('rule_violation');
    expect(applied(t.legendary('pounce', [{ actionId: 'rend', targetTokenIds: [t.goblin] }]))).toBe(true);
    expect(rejection(t.legendary('pounce', [{ actionId: 'rend', targetTokenIds: [t.goblin] }]))).toBe('rule_violation');
    // No covil, um uso a mais.
    t.session.handle(GM.playerId, { kind: 'monster.lair', data: { tokenId: t.dragon, lair: true } });
    expect(applied(t.legendary('pounce', [{ actionId: 'rend', targetTokenIds: [t.goblin] }]))).toBe(true);

    t.session.handle(GM.playerId, { kind: 'combat.start', data: { tokenIds: [t.dragon, t.goblin] } });
    t.session.handle(GM.playerId, { kind: 'combat.next', data: {} });
    t.session.handle(GM.playerId, { kind: 'combat.next', data: {} });
    expect(t.spent()).toEqual({});
  });

  it('a text legendary action is spent by hand, a save action spends it when forced', () => {
    const t = table([10]);
    const mapId = t.session.state.activeMapId ?? '';
    t.session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Lich', position: { x: 1200, y: 0 }, size: 'medium', monsterId: 'lich' } });
    const lich = Object.values(t.session.state.tokens).find((x) => x.name === 'Lich')?.id ?? '';
    const spent = () => t.session.state.tokens[lich]?.uses.spent;
    expect(applied(t.session.handle(GM.playerId, { kind: 'monster.use', data: { tokenId: lich, featureId: 'deathly_teleport', change: 'spend' } }))).toBe(true);
    expect(spent()).toEqual({ legendary_actions: 1 });
    t.session.handle(GM.playerId, { kind: 'save.force', data: { source: { tokenId: lich, actionId: 'disrupt_life' }, targetTokenIds: [t.goblin], visibility: 'public' } });
    expect(spent()).toEqual({ legendary_actions: 2, disrupt_life: 1 });
  });
});

describe('HostSession: Legendary Resistance (note 0069)', () => {
  /** Um leão ruge para o dragão (Amedrontado na falha), com dados fixos. */
  function roar(rolls: number[]) {
    const t = table(rolls);
    const mapId = t.session.state.activeMapId ?? '';
    const create = (name: string, monsterId: string, x: number) => {
      t.session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name, position: { x, y: 500 }, size: 'medium', monsterId } });
      return Object.values(t.session.state.tokens).find((k) => k.name === name)?.id ?? '';
    };
    const lion = create('Leão', 'lion', 1100);
    const mage = create('Mago', 'mage', 1300);
    const force = () => t.session.handle(GM.playerId, { kind: 'save.force', data: { source: { tokenId: lion, actionId: 'roar' }, targetTokenIds: [t.dragon, t.goblin], visibility: 'public' } });
    const pending = () => Object.values(t.session.state.pendingSaves);
    const resolve = (useResistance: boolean, playerId = GM.playerId) => t.session.handle(playerId, { kind: 'save.resolve', data: { pendingId: pending()[0]?.id ?? '', useResistance } });
    const active = () => t.session.state.tokens[t.dragon]?.conditions.active.map((c) => c.condition);
    return { ...t, lion, mage, force, pending, resolve, active };
  }

  it('holds the consequences of the failure, only for who has it', () => {
    const t = roar([1]);
    t.force();
    expect(t.active()).toEqual([]);
    expect(t.session.state.tokens[t.goblin]?.conditions.active.map((c) => c.condition)).toEqual(['frightened']);
    expect(t.pending()).toMatchObject([{ targetTokenId: t.dragon, impose: { actorTokenId: t.lion, actionId: 'roar' } }]);
    expect(t.session.state.chat.findLast((e) => e.kind === 'save_roll')).toMatchObject({ results: [{ success: false, notes: ['Aguardando o mestre'] }, { success: false }] });
    expect(t.session.viewFor(ANA.playerId).pendingSaves).toEqual({});
    expect(SessionStateSchema.safeParse(t.session.state).success).toBe(true);
  });

  it('used: spends it and nothing enters; accepted: the condition enters', () => {
    const t = roar([1]);
    t.force();
    expect(rejection(t.resolve(true, ANA.playerId))).toBe('not_allowed');
    expect(applied(t.resolve(true))).toBe(true);
    expect(t.active()).toEqual([]);
    expect(t.spent()).toEqual({ legendary_resistance: 1 });
    expect(t.pending()).toEqual([]);
    expect(t.session.state.chat.at(-1)).toMatchObject({ kind: 'legendary_resistance', used: true, name: 'Dragão', label: 'Roar' });
    t.force();
    expect(applied(t.resolve(false))).toBe(true);
    expect(t.active()).toEqual(['frightened']);
    expect(t.spent()).toEqual({ legendary_resistance: 1 });
    expect(rejection(t.resolve(false))).toBe('rule_violation');
  });

  it('a success, or no uses left, does not wait', () => {
    const t = roar([20]);
    t.force();
    expect(t.pending()).toEqual([]);
    const u = roar([1]);
    for (let i = 0; i < 3; i++) u.session.handle(GM.playerId, { kind: 'monster.use', data: { tokenId: u.dragon, featureId: 'legendary_resistance', change: 'spend' } });
    u.force();
    expect(u.pending()).toEqual([]);
    expect(u.active()).toEqual(['frightened']);
  });

  it('two failures with one use left: the second can only be accepted', () => {
    const t = roar([1]);
    for (let i = 0; i < 2; i++) t.session.handle(GM.playerId, { kind: 'monster.use', data: { tokenId: t.dragon, featureId: 'legendary_resistance', change: 'spend' } });
    t.force();
    t.force();
    expect(t.pending()).toHaveLength(2);
    expect(applied(t.resolve(true))).toBe(true);
    expect(rejection(t.resolve(true))).toBe('rule_violation');
    expect(t.pending()).toHaveLength(1);
    expect(applied(t.resolve(false))).toBe(true);
  });

  it('the damage becomes a proposal only after the decision: half with the resistance', () => {
    const t = roar([1]);
    const fireball = () => {
      t.session.handle(GM.playerId, { kind: 'monster.cast', data: { tokenId: t.mage, spellId: 'cone_of_cold' } });
      const entry = t.session.state.chat.findLast((e) => e.kind === 'spell_cast');
      t.session.handle(GM.playerId, { kind: 'spell.effect', data: { entryId: entry?.id ?? '', part: 0, targetTokenIds: [t.dragon] } });
    };
    fireball();
    expect(t.session.state.proposals).toEqual({});
    const [first] = t.pending();
    // Cone of Cold: 8d8, todos 1.
    expect(first?.damage).toMatchObject({ failed: 8, saved: 4 });
    t.resolve(true);
    expect(Object.values(t.session.state.proposals)).toMatchObject([{ id: first?.damage?.proposalId, amount: 4 }]);
  });

  it('spell effects wait too, and do not enter if the spell is over', () => {
    const t = roar([1]);
    const mapId = t.session.state.activeMapId ?? '';
    t.session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Prata', position: { x: 1500, y: 500 }, size: 'huge', monsterId: 'adult_silver_dragon' } });
    const silver = Object.values(t.session.state.tokens).find((k) => k.name === 'Prata')?.id ?? '';
    const hold = () => {
      t.session.handle(GM.playerId, { kind: 'monster.cast', data: { tokenId: silver, spellId: 'hold_monster' } });
      const entry = t.session.state.chat.findLast((e) => e.kind === 'spell_cast');
      return t.session.handle(GM.playerId, { kind: 'spell.effect', data: { entryId: entry?.id ?? '', part: 0, targetTokenIds: [t.dragon] } });
    };
    expect(applied(hold())).toBe(true);
    expect(t.active()).toEqual([]);
    t.resolve(false);
    expect(t.active()).toEqual(['paralyzed']);
    t.session.handle(GM.playerId, { kind: 'concentration.end', data: { tokenId: silver } });
    expect(t.active()).toEqual([]);
    hold();
    t.session.handle(GM.playerId, { kind: 'concentration.end', data: { tokenId: silver } });
    t.resolve(false);
    expect(t.active()).toEqual([]);
  });

  it('the Concentration save waits, and removing the token drops what was pending', () => {
    const t = roar([1]);
    t.session.handle(GM.playerId, { kind: 'monster.cast', data: { tokenId: t.dragon, spellId: 'detect_magic' } });
    expect(t.session.state.tokens[t.dragon]?.concentration?.spellId).toBe('detect_magic');
    const hurt = () => t.session.handle(GM.playerId, { kind: 'hp.change', data: { target: { tokenId: t.dragon }, change: { kind: 'damage', amount: 40 } } });
    hurt();
    expect(t.session.state.tokens[t.dragon]?.concentration).not.toBeNull();
    t.resolve(true);
    expect(t.session.state.tokens[t.dragon]?.concentration).not.toBeNull();
    hurt();
    t.resolve(false);
    expect(t.session.state.tokens[t.dragon]?.concentration).toBeNull();
    t.force();
    expect(t.pending()).toHaveLength(1);
    t.session.handle(GM.playerId, { kind: 'token.remove', data: { tokenId: t.dragon } });
    expect(t.pending()).toEqual([]);
  });
});
