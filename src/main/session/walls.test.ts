import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { seededRng } from 'rules-engine';
import { describe, expect, it } from 'vitest';
import { applyPatch, extractWallsFrom3dMapDocument, type Intent, MAX_MAP_WALLS, type SessionState, SessionStateSchema, WORLD_UNITS_PER_CELL } from '../../shared/protocol';
import { HostSession } from './executor';

const CAMPAIGN = { id: randomUUID(), name: 'A Mina Perdida' };
const GM = { playerId: randomUUID(), displayName: 'Mestre' };
const ANA = { playerId: randomUUID(), displayName: 'Ana' };
const BRUNO = { playerId: randomUUID(), displayName: 'Bruno' };
const SCENE_3D_SHA = 'c'.repeat(64);

function setup(sceneDoc?: unknown): HostSession {
  const session = new HostSession(CAMPAIGN, GM, {
    rng: seededRng(1),
    now: () => 1763769600000,
    newId: randomUUID,
    monsterExists: () => false,
    pruneSteps: (steps) => steps,
    itemProblems: () => [],
    characterSheet: () => undefined,
    monsterHpMax: () => undefined,
    creature: () => undefined,
    spell: () => undefined,
    assetExists: (sha) => sha === SCENE_3D_SHA && sceneDoc !== undefined,
    readAsset: (sha) => (sha === SCENE_3D_SHA && sceneDoc !== undefined ? Buffer.from(JSON.stringify(sceneDoc), 'utf8') : undefined),
  });
  session.connect(ANA);
  session.connect(BRUNO);
  return session;
}

describe('HostSession: walls, doors, and token movement collision', () => {
  it('restricts wall.* intents to GM and supports add/update/replace/remove with patch consistency', () => {
    const session = setup();
    session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Forte', width: 10, height: 10 } });
    const mapId = Object.keys(session.state.maps)[0] ?? '';

    const playerBlocked: Intent[] = [
      { kind: 'wall.add', data: { mapId, walls: [{ x1: 2, y1: 0, x2: 2, y2: 5, kind: 'wall' }] } },
      { kind: 'wall.replace', data: { mapId, scope: 'all', walls: [] } },
    ];
    for (const intent of playerBlocked) {
      const res = session.handle(ANA.playerId, intent);
      expect(res.result.status).toBe('rejected');
      if (res.result.status === 'rejected') expect(res.result.code).toBe('not_allowed');
    }

    let anaView: SessionState = session.viewFor(ANA.playerId);
    const apply = (actorId: string, intent: Intent) => {
      const out = session.handle(actorId, intent);
      expect(out.result.status).toBe('applied');
      expect(SessionStateSchema.safeParse(session.state).success).toBe(true);
      if (out.change) {
        const p = session.patchFor(out.change, ANA.playerId);
        anaView = applyPatch(anaView, p.ops);
        expect(anaView).toEqual(session.viewFor(ANA.playerId));
      }
    };

    apply(GM.playerId, {
      kind: 'wall.add',
      data: {
        mapId,
        walls: [
          { x1: 3, y1: 0, x2: 3, y2: 4, kind: 'wall' },
          { x1: 3, y1: 4, x2: 3, y2: 5, kind: 'door', open: false, locked: false },
        ],
      },
    });
    expect(session.state.maps[mapId]?.walls.length).toBe(2);
    const wallId = session.state.maps[mapId]?.walls[0]?.id ?? '';
    const doorId = session.state.maps[mapId]?.walls[1]?.id ?? '';

    apply(GM.playerId, { kind: 'wall.update', data: { mapId, wallId, kind: 'window' } });
    expect(session.state.maps[mapId]?.walls[0]?.kind).toBe('window');

    apply(GM.playerId, { kind: 'wall.remove', data: { mapId, wallIds: [wallId] } });
    expect(session.state.maps[mapId]?.walls.map((w) => w.id)).toEqual([doorId]);

    apply(GM.playerId, {
      kind: 'wall.replace',
      data: { mapId, scope: 'manual', walls: [{ x1: 5, y1: 0, x2: 5, y2: 10, kind: 'wall' }] },
    });
    expect(session.state.maps[mapId]?.walls.length).toBe(1);
    expect(session.state.maps[mapId]?.walls[0]?.x1).toBe(5);
  });

  it('blocks player movement through walls and closed doors, lets nearby player toggle unlocked doors, and lets GM bypass', () => {
    const session = setup();
    session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Corredor', width: 10, height: 10 } });
    const mapId = Object.keys(session.state.maps)[0] ?? '';
    session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Ana', position: { x: 1 * WORLD_UNITS_PER_CELL, y: 2 * WORLD_UNITS_PER_CELL }, size: 'medium', ownerIds: [ANA.playerId] } });
    session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Bruno', position: { x: 8 * WORLD_UNITS_PER_CELL, y: 2 * WORLD_UNITS_PER_CELL }, size: 'medium', ownerIds: [BRUNO.playerId] } });

    const anaTokenId = Object.values(session.state.tokens).find((t) => t.name === 'Ana')?.id ?? '';

    session.handle(GM.playerId, {
      kind: 'wall.add',
      data: {
        mapId,
        walls: [
          { x1: 3, y1: 0, x2: 3, y2: 2, kind: 'wall' },
          { x1: 3, y1: 2, x2: 3, y2: 3, kind: 'door', open: false, locked: false },
          { x1: 3, y1: 3, x2: 3, y2: 10, kind: 'wall' },
        ],
      },
    });
    const doorId = session.state.maps[mapId]?.walls[1]?.id ?? '';

    // Player cannot walk through wall
    const blockedWall = session.handle(ANA.playerId, {
      kind: 'token.move',
      data: { tokenId: anaTokenId, to: { x: 4 * WORLD_UNITS_PER_CELL, y: 1 * WORLD_UNITS_PER_CELL } },
    });
    expect(blockedWall.result.status).toBe('rejected');
    if (blockedWall.result.status === 'rejected') expect(blockedWall.result.code).toBe('rule_violation');

    // Player cannot walk through closed door
    const blockedDoor = session.handle(ANA.playerId, {
      kind: 'token.move',
      data: { tokenId: anaTokenId, to: { x: 4 * WORLD_UNITS_PER_CELL, y: 2 * WORLD_UNITS_PER_CELL } },
    });
    expect(blockedDoor.result.status).toBe('rejected');

    // Bruno (at x=8.5, > 2 cells away) cannot toggle the door
    const farToggle = session.handle(BRUNO.playerId, { kind: 'door.toggle', data: { mapId, wallId: doorId } });
    expect(farToggle.result.status).toBe('rejected');
    if (farToggle.result.status === 'rejected') expect(farToggle.result.code).toBe('not_allowed');

    // Ana (at x=1.5, distance 1.5 <= 2 cells) opens the door and walks through
    expect(session.handle(ANA.playerId, { kind: 'door.toggle', data: { mapId, wallId: doorId } }).result.status).toBe('applied');
    expect(session.state.maps[mapId]?.walls[1]?.open).toBe(true);
    expect(
      session.handle(ANA.playerId, {
        kind: 'token.move',
        data: { tokenId: anaTokenId, to: { x: 4 * WORLD_UNITS_PER_CELL, y: 2 * WORLD_UNITS_PER_CELL } },
      }).result.status,
    ).toBe('applied');

    // Locked door blocks player toggle, GM can still toggle & move any token through walls
    session.handle(GM.playerId, { kind: 'wall.update', data: { mapId, wallId: doorId, open: false, locked: true } });
    expect(session.handle(ANA.playerId, { kind: 'door.toggle', data: { mapId, wallId: doorId } }).result.status).toBe('rejected');
    expect(session.handle(GM.playerId, { kind: 'door.toggle', data: { mapId, wallId: doorId } }).result.status).toBe('applied');
    expect(
      session.handle(GM.playerId, {
        kind: 'token.move',
        data: { tokenId: anaTokenId, to: { x: 1 * WORLD_UNITS_PER_CELL, y: 1 * WORLD_UNITS_PER_CELL } },
      }).result.status,
    ).toBe('applied');
  });

  it('auto-extracts baked_3d walls on map.create with scene3d and preserves manual walls on map.update', () => {
    const doc = {
      terrain: { width: 10, length: 10, heights: new Array<number>(11 * 11).fill(0), holes: new Array<number>(100).fill(0) },
      props: [
        { key: 'blackbeck.retaining_wall', tileX: 5, tileZ: 3, rotationDegrees: 0, scaleX: 1, scaleZ: 1 },
        { key: 'reedbank.swing_door', tileX: 5, tileZ: 6, rotationDegrees: 0, scaleX: 1, scaleZ: 1 },
      ],
    };
    const session = setup(doc);
    expect(session.handle(GM.playerId, { kind: 'map.create', data: { name: '3D', width: 10, height: 10, scene3d: SCENE_3D_SHA } }).result.status).toBe('applied');
    const mapId = Object.keys(session.state.maps)[0] ?? '';
    expect(session.state.maps[mapId]?.walls.length).toBe(2);
    expect(session.state.maps[mapId]?.walls.every((w) => w.source === 'baked_3d')).toBe(true);

    // Add a manual wall and update scene3d: manual wall stays, baked walls refresh
    session.handle(GM.playerId, { kind: 'wall.add', data: { mapId, walls: [{ x1: 1, y1: 1, x2: 1, y2: 5, kind: 'wall' }] } });
    expect(session.state.maps[mapId]?.walls.length).toBe(3);

    session.handle(GM.playerId, { kind: 'map.update', data: { mapId, scene3d: SCENE_3D_SHA } });
    const walls = session.state.maps[mapId]?.walls ?? [];
    expect(walls.filter((w) => w.source === 'manual').length).toBe(1);
    expect(walls.filter((w) => w.source === 'baked_3d').length).toBe(2);
  });

  it('extracts walls and doors cleanly from maps/grand-undercity-sewers.vttmap.json within MAX_MAP_WALLS', () => {
    const raw: unknown = JSON.parse(readFileSync(join(process.cwd(), 'maps', 'grand-undercity-sewers.vttmap.json'), 'utf8'));
    const extracted = extractWallsFrom3dMapDocument(raw);
    expect(extracted.length).toBeGreaterThan(20);
    expect(extracted.length).toBeLessThanOrEqual(MAX_MAP_WALLS);
    expect(extracted.some((w) => w.kind === 'wall')).toBe(true);
    expect(extracted.some((w) => w.kind === 'door')).toBe(true);
  });
});
