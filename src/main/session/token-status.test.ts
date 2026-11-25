import { randomUUID } from 'node:crypto';
import { seededRng } from 'rules-engine';
import { describe, expect, it } from 'vitest';
import { applyPatch, type Intent, type SessionState, SessionStateSchema } from '../../shared/protocol';
import { HostSession } from './executor';

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
    creature: () => undefined,
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
