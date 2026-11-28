import { randomUUID } from 'node:crypto';
import { loadSrdCompendium, seededRng } from 'rules-engine';
import { describe, expect, it } from 'vitest';
import { applyPatch, ChatEntrySchema, type Intent, type SessionState, SessionStateSchema } from '../../shared/protocol';
import { HostSession } from './executor';
import { concealEntries, redactEntry } from './visibility';

const compendium = loadSrdCompendium();
const CAMPAIGN = { id: randomUUID(), name: 'A Mina Perdida' };
const GM = { playerId: randomUUID(), displayName: 'Mestre' };
const ANA = { playerId: randomUUID(), displayName: 'Ana' };

function setup(): HostSession {
  const session = new HostSession(CAMPAIGN, GM, {
    rng: seededRng(1),
    now: () => 1763769600000,
    newId: randomUUID,
    monsterExists: (id) => id === 'goblin',
    pruneSteps: (steps) => steps,
    itemProblems: () => [],
    characterSheet: () => undefined,
    monsterHpMax: (id) => (id === 'goblin' ? 7 : undefined),
    creature: (id) => compendium.creatures.find((c) => c.id === (id === 'goblin' ? 'goblin_warrior' : id)),
    item: () => undefined,
    spell: () => undefined,
    assetExists: () => false,
  });
  session.connect(ANA);
  return session;
}

/** Aplica uma intenção e confere que o `StatePatch` filtrado mantém a visão de cada jogador idêntica a `viewFor`. */
function applyAndCheckViews(session: HostSession, actorId: string, intent: Intent, views: Record<string, SessionState>): void {
  const outcome = session.handle(actorId, intent);
  expect(outcome.result.status).toBe('applied');
  expect(SessionStateSchema.safeParse(session.state).success).toBe(true);
  if (!outcome.change) return;
  for (const playerId of Object.keys(views)) {
    const prev = views[playerId];
    if (!prev) continue;
    const patch = session.patchFor(outcome.change, playerId);
    const next = applyPatch(prev, patch.ops);
    expect(next).toEqual(session.viewFor(playerId));
    views[playerId] = next;
  }
}

describe('HostSession: hidden tokens and dead indicator', () => {
  it('restricts token.hidden and token.dead to the GM', () => {
    const session = setup();
    session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Caverna', width: 10, height: 10 } });
    const mapId = Object.keys(session.state.maps)[0] ?? '';
    session.handle(GM.playerId, {
      kind: 'token.create',
      data: { mapId, name: 'Goblin 1', position: { x: 0, y: 0 }, size: 'small', monsterId: 'goblin' },
    });
    const tokenId = Object.keys(session.state.tokens)[0] ?? '';

    for (const intent of [
      { kind: 'token.hidden', data: { tokenId, hidden: true } },
      { kind: 'token.dead', data: { tokenId, dead: true } },
    ] satisfies Intent[]) {
      const outcome = session.handle(ANA.playerId, intent);
      expect(outcome.result.status).toBe('rejected');
      if (outcome.result.status === 'rejected') expect(outcome.result.code).toBe('not_allowed');
    }
  });

  it('filters hidden tokens from non-GM snapshots and patches, even if owned, and restores them when revealed', () => {
    const session = setup();
    const views: Record<string, SessionState> = {
      [GM.playerId]: session.viewFor(GM.playerId),
      [ANA.playerId]: session.viewFor(ANA.playerId),
    };

    applyAndCheckViews(session, GM.playerId, { kind: 'map.create', data: { name: 'Caverna', width: 10, height: 10 } }, views);
    const mapId = Object.keys(session.state.maps)[0] ?? '';
    applyAndCheckViews(
      session,
      GM.playerId,
      { kind: 'token.create', data: { mapId, name: 'Goblin 1', position: { x: 200, y: 200 }, size: 'small', monsterId: 'goblin' } },
      views,
    );
    const goblinId = Object.keys(session.state.tokens)[0] ?? '';
    expect(views[ANA.playerId]?.tokens[goblinId]).toBeDefined();

    // Esconde o goblin: some da visão da Ana via patch `remove`, continua no estado do mestre.
    applyAndCheckViews(session, GM.playerId, { kind: 'token.hidden', data: { tokenId: goblinId, hidden: true } }, views);
    expect(views[GM.playerId]?.tokens[goblinId]?.hidden).toBe(true);
    expect(views[ANA.playerId]?.tokens[goblinId]).toBeUndefined();

    // Mover ou ferir o goblin oculto não vaza nada para a Ana.
    applyAndCheckViews(session, GM.playerId, { kind: 'token.move', data: { tokenId: goblinId, to: { x: 400, y: 400 } } }, views);
    applyAndCheckViews(session, GM.playerId, { kind: 'hp.change', data: { target: { tokenId: goblinId }, change: { kind: 'damage', amount: 3 } } }, views);
    expect(views[ANA.playerId]?.tokens[goblinId]).toBeUndefined();

    // Revela o goblin: volta para a Ana na posição nova, com `hp: null` (PV de monstro continua oculto).
    applyAndCheckViews(session, GM.playerId, { kind: 'token.hidden', data: { tokenId: goblinId, hidden: false } }, views);
    expect(views[ANA.playerId]?.tokens[goblinId]?.position).toEqual({ x: 400, y: 400 });
    expect(views[ANA.playerId]?.tokens[goblinId]?.hp).toBeNull();
    expect(views[ANA.playerId]?.tokens[goblinId]?.hidden).toBe(false);
  });

  it('keeps the lights carried by hidden tokens out of the players state (review of 2026-11-28)', () => {
    const session = setup();
    session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Caverna', width: 10, height: 10 } });
    const mapId = Object.keys(session.state.maps)[0] ?? '';
    session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Assassino', position: { x: 0, y: 0 }, size: 'medium', monsterId: 'goblin' } });
    const tokenId = Object.keys(session.state.tokens)[0] ?? '';
    const views: Record<string, SessionState> = { [ANA.playerId]: session.viewFor(ANA.playerId) };
    const lights = (): string[] => (views[ANA.playerId]?.maps[mapId]?.lights ?? []).map((l) => l.name);
    applyAndCheckViews(session, GM.playerId, { kind: 'token.hidden', data: { tokenId, hidden: true } }, views);
    // Luz nova num token oculto: o mestre vê, o jogador não.
    applyAndCheckViews(session, GM.playerId, { kind: 'light.add', data: { mapId, light: { name: 'Tocha do assassino', kind: 'light', attach: { kind: 'token', tokenId } } } }, views);
    applyAndCheckViews(session, GM.playerId, { kind: 'light.add', data: { mapId, light: { name: 'Braseiro', kind: 'light', attach: { kind: 'point', x: 5, y: 5 } } } }, views);
    expect(session.state.maps[mapId]?.lights.map((l) => l.name)).toEqual(['Tocha do assassino', 'Braseiro']);
    expect(lights()).toEqual(['Braseiro']);
    // Revelado, a tocha aparece; escondido de novo, some.
    applyAndCheckViews(session, GM.playerId, { kind: 'token.hidden', data: { tokenId, hidden: false } }, views);
    expect(lights()).toEqual(['Tocha do assassino', 'Braseiro']);
    applyAndCheckViews(session, GM.playerId, { kind: 'token.hidden', data: { tokenId, hidden: true } }, views);
    expect(lights()).toEqual(['Braseiro']);
    expect(JSON.stringify(session.viewFor(ANA.playerId))).not.toContain(tokenId);
  });

  it('keeps hidden tokens out of the combat order and the chat of players', () => {
    const session = setup();
    const views: Record<string, SessionState> = { [GM.playerId]: session.viewFor(GM.playerId), [ANA.playerId]: session.viewFor(ANA.playerId) };
    const gm = (intent: Intent): void => {
      applyAndCheckViews(session, GM.playerId, intent, views);
    };
    const ana = (): SessionState => views[ANA.playerId] ?? session.state;
    gm({ kind: 'map.create', data: { name: 'Caverna', width: 10, height: 10 } });
    const mapId = Object.keys(session.state.maps)[0] ?? '';
    for (const [i, name] of ['Guarda', 'Assassino'].entries()) {
      gm({ kind: 'token.create', data: { mapId, name, position: { x: i * 200, y: 0 }, size: 'small', monsterId: 'goblin' } });
    }
    const idOf = (name: string): string => Object.values(session.state.tokens).find((t) => t.name === name)?.id ?? '';
    const [guard, assassin] = [idOf('Guarda'), idOf('Assassino')];
    gm({ kind: 'token.hidden', data: { tokenId: assassin, hidden: true } });

    gm({ kind: 'combat.start', data: { tokenIds: [guard, assassin] } });
    gm({ kind: 'combat.set_initiative', data: { tokenId: assassin, initiative: 20 } });
    gm({ kind: 'combat.set_initiative', data: { tokenId: guard, initiative: 1 } });
    gm({ kind: 'condition.add', data: { target: { tokenId: assassin }, condition: 'prone' } });
    gm({ kind: 'condition.add', data: { target: { tokenId: guard }, condition: 'prone' } });
    gm({
      kind: 'save.force',
      data: {
        source: { custom: { name: 'Fogo', ability: 'dex', dc: 12, damage: [{ dice: '1d6', type: 'fire' }], onSuccess: 'none' } },
        targetTokenIds: [guard, assassin],
        visibility: 'public',
      },
    });
    expect(ana().combat?.combatants.map((c) => c.tokenId)).toEqual([guard]);
    expect(JSON.stringify(ana())).not.toContain('Assassino');
    expect(JSON.stringify(ana())).not.toContain(assassin);
    expect(ana().chat.length).toBe(session.state.chat.length);
    expect(ana().chat.some((e) => e.kind === 'condition_changed' && e.targetName === 'Guarda')).toBe(true);
    expect(ana().chat.some((e) => e.kind === 'hidden_roll' && e.silent === true)).toBe(true);
    const save = ana().chat.find((e) => e.kind === 'save_roll');
    expect(save?.kind === 'save_roll' ? save.results.map((r) => r.targetTokenId) : []).toEqual([guard]);

    // A vez passa pelos dois: só a do oculto chega como `hiddenTurn`.
    const turns = [0, 1].map(() => {
      const current = session.state.combat?.combatants[session.state.combat.turn]?.tokenId;
      const seen = ana().combat?.hiddenTurn === true;
      gm({ kind: 'combat.next', data: {} });
      return current === assassin ? seen : !seen;
    });
    expect(turns).toEqual([true, true]);

    // Revelar devolve o combatente, sem expor o passado; esconder tudo tira o combate.
    gm({ kind: 'token.hidden', data: { tokenId: assassin, hidden: false } });
    expect(ana().combat?.combatants).toHaveLength(2);
    expect(ana().chat.some((e) => e.kind === 'condition_changed' && e.targetName === 'Assassino')).toBe(false);
    gm({ kind: 'token.hidden', data: { tokenId: assassin, hidden: true } });
    gm({ kind: 'token.hidden', data: { tokenId: guard, hidden: true } });
    expect(ana().combat).toBeNull();
  });

  it('masks a hidden actor and keeps the visible target', () => {
    const base = { id: randomUUID(), at: 1, authorId: GM.playerId };
    const tokens: SessionState['tokens'] = {};
    const session = setup();
    session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Caverna', width: 10, height: 10 } });
    const mapId = Object.keys(session.state.maps)[0] ?? '';
    session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Assassino', position: { x: 0, y: 0 }, size: 'small' } });
    for (const t of Object.values(session.state.tokens)) tokens[t.id] = { ...t, hidden: true };
    const [op] = concealEntries(
      [{ op: 'add', path: '/chat/-', value: { kind: 'timed_effect', ...base, event: 'started', effect: 'sap', sourceName: 'Assassino', targetTokenId: randomUUID(), targetName: 'Thorin' } }],
      tokens,
    );
    const entry = ChatEntrySchema.parse(op && 'value' in op ? op.value : undefined);
    expect(redactEntry(entry, { playerId: ANA.playerId, role: 'player' }, tokens)).toEqual({
      kind: 'timed_effect', ...base, event: 'started', effect: 'sap', sourceName: 'Desconhecido', targetTokenId: expect.any(String) as string, targetName: 'Thorin',
    });
    expect(redactEntry(entry, { playerId: GM.playerId, role: 'gm' }, tokens)).toMatchObject({ sourceName: 'Assassino' });
  });

  it('automatically marks monster tokens dead at 0 PV, clears on healing, and allows GM manual override', () => {
    const session = setup();
    const views: Record<string, SessionState> = {
      [GM.playerId]: session.viewFor(GM.playerId),
      [ANA.playerId]: session.viewFor(ANA.playerId),
    };

    applyAndCheckViews(session, GM.playerId, { kind: 'map.create', data: { name: 'Caverna', width: 10, height: 10 } }, views);
    const mapId = Object.keys(session.state.maps)[0] ?? '';
    applyAndCheckViews(
      session,
      GM.playerId,
      { kind: 'token.create', data: { mapId, name: 'Goblin 1', position: { x: 100, y: 100 }, size: 'small', monsterId: 'goblin' } },
      views,
    );
    const goblinId = Object.keys(session.state.tokens)[0] ?? '';
    expect(views[ANA.playerId]?.tokens[goblinId]?.dead).toBe(false);

    // Dano letal (7 PV): marca automaticamente como morto para o mestre e para os jogadores (mesmo com hp: null).
    applyAndCheckViews(session, GM.playerId, { kind: 'hp.change', data: { target: { tokenId: goblinId }, change: { kind: 'damage', amount: 7 } } }, views);
    expect(views[GM.playerId]?.tokens[goblinId]?.dead).toBe(true);
    expect(views[ANA.playerId]?.tokens[goblinId]?.dead).toBe(true);
    expect(views[ANA.playerId]?.tokens[goblinId]?.hp).toBeNull();

    // Override manual do mestre (ex.: golpe não letal a 0 PV): desmarca como morto.
    applyAndCheckViews(session, GM.playerId, { kind: 'token.dead', data: { tokenId: goblinId, dead: false } }, views);
    expect(views[GM.playerId]?.tokens[goblinId]?.dead).toBe(false);
    expect(views[ANA.playerId]?.tokens[goblinId]?.dead).toBe(false);

    // Marca manualmente como morto e depois cura acima de 0 PV: cura limpa `dead`.
    applyAndCheckViews(session, GM.playerId, { kind: 'token.dead', data: { tokenId: goblinId, dead: true } }, views);
    expect(views[ANA.playerId]?.tokens[goblinId]?.dead).toBe(true);
    applyAndCheckViews(session, GM.playerId, { kind: 'hp.change', data: { target: { tokenId: goblinId }, change: { kind: 'healing', amount: 2 } } }, views);
    expect(views[GM.playerId]?.tokens[goblinId]?.dead).toBe(false);
    expect(views[ANA.playerId]?.tokens[goblinId]?.dead).toBe(false);

    // Exaustão 6 num token de monstro também o marca como morto.
    applyAndCheckViews(session, GM.playerId, { kind: 'exhaustion.set', data: { target: { tokenId: goblinId }, level: 6 } }, views);
    expect(views[GM.playerId]?.tokens[goblinId]?.dead).toBe(true);
    expect(views[ANA.playerId]?.tokens[goblinId]?.dead).toBe(true);
  });

  it('syncs character deathSaves.dead when the GM toggles token.dead on a character token', () => {
    const session = setup();
    const views: Record<string, SessionState> = {
      [GM.playerId]: session.viewFor(GM.playerId),
      [ANA.playerId]: session.viewFor(ANA.playerId),
    };

    applyAndCheckViews(session, GM.playerId, { kind: 'map.create', data: { name: 'Caverna', width: 10, height: 10 } }, views);
    const mapId = Object.keys(session.state.maps)[0] ?? '';
    applyAndCheckViews(session, ANA.playerId, { kind: 'character.create', data: { name: 'Thorin' } }, views);
    const charId = Object.keys(session.state.characters)[0] ?? '';
    applyAndCheckViews(
      session,
      GM.playerId,
      { kind: 'token.create', data: { mapId, name: 'Thorin', position: { x: 0, y: 0 }, size: 'medium', ownerIds: [ANA.playerId], characterId: charId } },
      views,
    );
    const tokenId = Object.keys(session.state.tokens)[0] ?? '';

    applyAndCheckViews(session, GM.playerId, { kind: 'token.dead', data: { tokenId, dead: true } }, views);
    expect(session.state.characters[charId]?.deathSaves.dead).toBe(true);
    expect(views[ANA.playerId]?.characters[charId]?.deathSaves.dead).toBe(true);

    applyAndCheckViews(session, GM.playerId, { kind: 'token.dead', data: { tokenId, dead: false } }, views);
    expect(session.state.characters[charId]?.deathSaves.dead).toBe(false);
    expect(views[ANA.playerId]?.characters[charId]?.deathSaves.dead).toBe(false);
  });
});
