import { randomUUID } from 'node:crypto';
import { seededRng } from 'rules-engine';
import { describe, expect, it } from 'vitest';
import { applyPatch, decodeFogBits, getFogCell, type Intent, type SessionState, SessionStateSchema, WORLD_UNITS_PER_CELL } from '../../shared/protocol';
import { HostSession } from './executor';

const CAMPAIGN = { id: randomUUID(), name: 'A Mina Perdida' };
const GM = { playerId: randomUUID(), displayName: 'Mestre' };
const ANA = { playerId: randomUUID(), displayName: 'Ana' };
const BRUNO = { playerId: randomUUID(), displayName: 'Bruno' };

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
    item: () => undefined,
    spell: () => undefined,
    assetExists: () => false,
  });
  session.connect(ANA);
  session.connect(BRUNO);
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

describe('HostSession: fog of war', () => {
  it('restricts all fog and token vision intents to the GM', () => {
    const session = setup();
    session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Caverna', width: 10, height: 10 } });
    const mapId = Object.keys(session.state.maps)[0] ?? '';
    session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Ana', position: { x: 0, y: 0 }, size: 'medium', ownerIds: [ANA.playerId] } });
    const tokenId = Object.keys(session.state.tokens)[0] ?? '';

    const gmOnly: Intent[] = [
      { kind: 'fog.manual.paint', data: { mapId, mode: 'cover', cells: [{ x: 0, y: 0 }] } },
      { kind: 'fog.manual.rect', data: { mapId, mode: 'cover', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } } },
      { kind: 'fog.manual.fill', data: { mapId, mode: 'cover' } },
      { kind: 'fog.config', data: { mapId, autoEnabled: true } },
      { kind: 'fog.memory.clear', data: { mapId } },
      { kind: 'token.vision', data: { tokenId, visionFeet: 30 } },
    ];
    for (const intent of gmOnly) {
      const outcome = session.handle(ANA.playerId, intent);
      expect(outcome.result.status).toBe('rejected');
      if (outcome.result.status === 'rejected') expect(outcome.result.code).toBe('not_allowed');
    }
  });

  it('keeps manual fog independent from automatic vision, records explored memory, clears memory, and syncs hidden tokens via patches', () => {
    const session = setup();
    const views: Record<string, SessionState> = {
      [GM.playerId]: session.viewFor(GM.playerId),
      [ANA.playerId]: session.viewFor(ANA.playerId),
      [BRUNO.playerId]: session.viewFor(BRUNO.playerId),
    };

    // Cria mapa 10×10, token da Ana em (0,0), token do Bruno em (9,9) e um Goblin em (4,0)
    applyAndCheckViews(session, GM.playerId, { kind: 'map.create', data: { name: 'Masmorra', width: 10, height: 10 } }, views);
    const mapId = Object.keys(session.state.maps)[0] ?? '';
    applyAndCheckViews(session, GM.playerId, { kind: 'token.create', data: { mapId, name: 'Ana', position: { x: 0, y: 0 }, size: 'medium', ownerIds: [ANA.playerId] } }, views);
    applyAndCheckViews(session, GM.playerId, { kind: 'token.create', data: { mapId, name: 'Bruno', position: { x: 9 * WORLD_UNITS_PER_CELL, y: 9 * WORLD_UNITS_PER_CELL }, size: 'medium', ownerIds: [BRUNO.playerId] } }, views);
    applyAndCheckViews(session, GM.playerId, { kind: 'token.create', data: { mapId, name: 'Goblin', position: { x: 4 * WORLD_UNITS_PER_CELL, y: 0 }, size: 'small', monsterId: 'goblin' } }, views);

    const anaTokenId = Object.values(session.state.tokens).find((t) => t.name === 'Ana')?.id ?? '';
    const goblinId = Object.values(session.state.tokens).find((t) => t.name === 'Goblin')?.id ?? '';

    // Sem névoa ativa, Ana vê o Goblin
    expect(views[ANA.playerId]?.tokens[goblinId]).toBeDefined();

    // Mestre cobre a célula (1,0) manualmente ANTES de ativar a névoa automática
    applyAndCheckViews(session, GM.playerId, { kind: 'fog.manual.paint', data: { mapId, mode: 'cover', cells: [{ x: 1, y: 0 }] } }, views);

    // Ativa névoa automática com visão de 10 ft (2 células) e memória ligada
    applyAndCheckViews(session, GM.playerId, { kind: 'fog.config', data: { mapId, autoEnabled: true, visionFeet: 10, rememberExplored: true } }, views);

    // Goblin em (4,0) está fora da visão de 2 células da Ana (em 0,0) -> some da visão da Ana
    expect(views[ANA.playerId]?.tokens[goblinId]).toBeUndefined();
    expect(views[GM.playerId]?.tokens[goblinId]).toBeDefined();

    // Cada jogador só recebe a própria memória explorada (nunca a do outro)
    expect(views[ANA.playerId]?.maps[mapId]?.fog.explored[ANA.playerId]).toBeDefined();
    expect(views[ANA.playerId]?.maps[mapId]?.fog.explored[BRUNO.playerId]).toBeUndefined();
    expect(views[BRUNO.playerId]?.maps[mapId]?.fog.explored[BRUNO.playerId]).toBeDefined();
    expect(views[BRUNO.playerId]?.maps[mapId]?.fog.explored[ANA.playerId]).toBeUndefined();

    // Célula (1,0) está sob névoa manual -> NÃO entrou na memória explorada da Ana
    const anaExplored1 = decodeFogBits(session.state.maps[mapId]?.fog.explored[ANA.playerId] ?? '', 10, 10);
    expect(getFogCell(anaExplored1, 10, 0, 0)).toBe(true);
    expect(getFogCell(anaExplored1, 10, 1, 0)).toBe(false);

    // Mestre revela a névoa manual em (1,0) -> agora está na visão da Ana e entra na memória dela
    applyAndCheckViews(session, GM.playerId, { kind: 'fog.manual.paint', data: { mapId, mode: 'reveal', cells: [{ x: 1, y: 0 }] } }, views);
    const anaExplored2 = decodeFogBits(session.state.maps[mapId]?.fog.explored[ANA.playerId] ?? '', 10, 10);
    expect(getFogCell(anaExplored2, 10, 1, 0)).toBe(true);

    // Ana anda para (3,0): Goblin em (4,0) entra na visão -> aparece via patch!
    applyAndCheckViews(session, ANA.playerId, { kind: 'token.move', data: { tokenId: anaTokenId, to: { x: 3 * WORLD_UNITS_PER_CELL, y: 0 } } }, views);
    expect(views[ANA.playerId]?.tokens[goblinId]).toBeDefined();
    expect(views[ANA.playerId]?.tokens[goblinId]?.hp).toBeNull(); // PV de monstro continuam ocultos

    // Ana volta para (0,0): célula (4,0) continua na memória explorada, mas Goblin sai da visão atual -> oculto!
    applyAndCheckViews(session, ANA.playerId, { kind: 'token.move', data: { tokenId: anaTokenId, to: { x: 0, y: 0 } } }, views);
    expect(views[ANA.playerId]?.tokens[goblinId]).toBeUndefined();
    const anaExplored3 = decodeFogBits(session.state.maps[mapId]?.fog.explored[ANA.playerId] ?? '', 10, 10);
    expect(getFogCell(anaExplored3, 10, 4, 0)).toBe(true);

    // Aumentar visão do token da Ana para 25 ft (5 células) revela o Goblin de longe
    applyAndCheckViews(session, GM.playerId, { kind: 'token.vision', data: { tokenId: anaTokenId, visionFeet: 25 } }, views);
    expect(views[ANA.playerId]?.tokens[goblinId]).toBeDefined();

    // Cobrir (4,0) com névoa manual esconde o Goblin mesmo dentro da visão de 25 ft
    applyAndCheckViews(session, GM.playerId, { kind: 'fog.manual.rect', data: { mapId, mode: 'cover', from: { x: 4, y: 0 }, to: { x: 4, y: 0 } } }, views);
    expect(views[ANA.playerId]?.tokens[goblinId]).toBeUndefined();

    // Limpar memória só da Ana mantém a do Bruno
    applyAndCheckViews(session, GM.playerId, { kind: 'fog.memory.clear', data: { mapId, playerId: ANA.playerId } }, views);
    expect(session.state.maps[mapId]?.fog.explored[ANA.playerId]).toBeUndefined();
    expect(session.state.maps[mapId]?.fog.explored[BRUNO.playerId]).toBeDefined();

    // Limpar memória de todos zera tudo
    applyAndCheckViews(session, GM.playerId, { kind: 'fog.memory.clear', data: { mapId } }, views);
    expect(session.state.maps[mapId]?.fog.explored).toEqual({});

    // Cobrir tudo e revelar tudo manualmente
    applyAndCheckViews(session, GM.playerId, { kind: 'fog.manual.fill', data: { mapId, mode: 'cover' } }, views);
    expect(views[ANA.playerId]?.tokens[goblinId]).toBeUndefined();
    applyAndCheckViews(session, GM.playerId, { kind: 'fog.manual.fill', data: { mapId, mode: 'reveal' } }, views);
    expect(views[ANA.playerId]?.tokens[goblinId]).toBeDefined();
  });

  it('rejects out-of-bounds manual fog cells', () => {
    const session = setup();
    session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Pequeno', width: 5, height: 5 } });
    const mapId = Object.keys(session.state.maps)[0] ?? '';
    const res = session.handle(GM.playerId, { kind: 'fog.manual.paint', data: { mapId, mode: 'cover', cells: [{ x: 5, y: 0 }] } });
    expect(res.result.status).toBe('rejected');
    if (res.result.status === 'rejected') expect(res.result.code).toBe('rule_violation');
  });
});
