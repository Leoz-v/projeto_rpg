import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSrdCompendium, seededRng } from 'rules-engine';
import { CharacterSchema } from 'rules-engine/schemas';
import { describe, expect, it } from 'vitest';
import elfWizard from '../../../packages/rules-engine/tests/fixtures/elf-wizard-7.json';
import humanCleric from '../../../packages/rules-engine/tests/fixtures/human-cleric-5.json';
import { characterSheet } from '../character-sheet';
import {
  applyPatch,
  decodeFogBits,
  extractPropLightsFrom3dMapDocument,
  hasAnyFogBit,
  hasLineOfSight2D,
  type Intent,
  type SessionState,
  SessionStateSchema,
  WORLD_UNITS_PER_CELL,
} from '../../shared/protocol';
import { HostSession } from './executor';
import { resolveAllTokenVisionProfiles } from './vision';

const compendium = loadSrdCompendium();
const CAMPAIGN = { id: randomUUID(), name: 'Visao D&D' };
const GM = { playerId: randomUUID(), displayName: 'Mestre' };
const ANA = { playerId: randomUUID(), displayName: 'Ana' };
const BRUNO = { playerId: randomUUID(), displayName: 'Bruno' };
const SEWER_SHA = 'e'.repeat(64);

function makeDeps(sewerDoc?: unknown) {
  return {
    rng: seededRng(1),
    now: () => 1763769600000,
    newId: randomUUID,
    monsterExists: (id: string) => compendium.creatures.some((c) => c.id === id),
    pruneSteps: (steps: never[]) => steps,
    itemProblems: () => [],
    characterSheet: (c: Parameters<typeof characterSheet>[0]) => characterSheet(c, compendium).sheet ?? undefined,
    monsterHpMax: (id: string) => compendium.creatures.find((c) => c.id === id)?.hp.average,
    creature: (id: string) => compendium.creatures.find((c) => c.id === id),
    spell: (id: string) => compendium.spells.find((s) => s.id === id),
    assetExists: (sha: string) => sha === SEWER_SHA && sewerDoc !== undefined,
    readAsset: (sha: string) => (sha === SEWER_SHA && sewerDoc !== undefined ? Buffer.from(JSON.stringify(sewerDoc), 'utf8') : undefined),
  };
}

function setup(sewerDoc?: unknown): HostSession {
  const deps = makeDeps(sewerDoc);
  const session = new HostSession(CAMPAIGN, GM, {
    ...deps,
    pruneSteps: (steps) => steps,
  });
  session.connect(ANA);
  session.connect(BRUNO);
  return session;
}

/** Aplica uma intenção e garante que `applyPatch(prevView, patch.ops)` resulta exatamente em `session.viewFor(playerId)`. */
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

function createCharacterFromFixture(
  session: HostSession,
  ownerId: string,
  fixture: unknown,
  views: Record<string, SessionState>,
): string {
  const parsed = CharacterSchema.parse(fixture);
  applyAndCheckViews(session, GM.playerId, { kind: 'character.create', data: { name: parsed.name, ownerId } }, views);
  const created = Object.values(session.state.characters).find((c) => c.ownerId === ownerId && c.name === parsed.name);
  if (!created) throw new Error('Expected created character');
  applyAndCheckViews(
    session,
    GM.playerId,
    { kind: 'character.update', data: { characterId: created.id, baseScores: parsed.baseScores, steps: parsed.steps } },
    views,
  );
  return created.id;
}

describe('HostSession: sheet-driven occluded vision and lighting', () => {
  it('blocks foreign tokens behind walls/closed doors and expands visibility + explored memory when door opens', () => {
    const session = setup();
    const views: Record<string, SessionState> = {
      [GM.playerId]: session.viewFor(GM.playerId),
      [ANA.playerId]: session.viewFor(ANA.playerId),
    };

    applyAndCheckViews(session, GM.playerId, { kind: 'map.create', data: { name: 'Forte', width: 12, height: 10 } }, views);
    const mapId = Object.keys(session.state.maps)[0] ?? '';
    applyAndCheckViews(session, GM.playerId, { kind: 'fog.config', data: { mapId, autoEnabled: true, visionFeet: 60, rememberExplored: true } }, views);
    applyAndCheckViews(
      session,
      GM.playerId,
      {
        kind: 'wall.add',
        data: {
          mapId,
          walls: [
            { x1: 5, y1: 0, x2: 5, y2: 4, kind: 'wall' },
            { x1: 5, y1: 4, x2: 5, y2: 6, kind: 'door', open: false },
            { x1: 5, y1: 6, x2: 5, y2: 10, kind: 'wall' },
          ],
        },
      },
      views,
    );
    const doorId = session.state.maps[mapId]?.walls.find((w) => w.kind === 'door')?.id ?? '';

    const mirielId = createCharacterFromFixture(session, ANA.playerId, humanCleric.character, views);
    applyAndCheckViews(
      session,
      GM.playerId,
      { kind: 'token.create', data: { mapId, name: 'Miriel', characterId: mirielId, position: { x: 2 * WORLD_UNITS_PER_CELL, y: 4 * WORLD_UNITS_PER_CELL }, size: 'medium', ownerIds: [ANA.playerId] } },
      views,
    );
    applyAndCheckViews(
      session,
      GM.playerId,
      { kind: 'token.create', data: { mapId, name: 'Sentinela', position: { x: 7 * WORLD_UNITS_PER_CELL, y: 4 * WORLD_UNITS_PER_CELL }, size: 'medium' } },
      views,
    );
    const guardId = Object.values(session.state.tokens).find((t) => t.name === 'Sentinela')?.id ?? '';

    // Door closed -> Guard at 25 ft behind door is hidden and eastern half is unexplored
    expect(views[ANA.playerId]?.tokens[guardId]).toBeUndefined();
    const exploredBefore = decodeFogBits(session.state.maps[mapId]?.fog.explored[ANA.playerId] ?? '', 12, 10);
    expect((exploredBefore[Math.floor((4 * 12 + 7) / 8)] ?? 0) & (1 << ((4 * 12 + 7) & 7))).toBe(0);

    // Open the door -> Guard immediately arrives via patch and explored memory expands past x=5
    applyAndCheckViews(session, GM.playerId, { kind: 'door.toggle', data: { mapId, wallId: doorId } }, views);
    expect(views[ANA.playerId]?.tokens[guardId]).toBeDefined();
    const exploredAfter = decodeFogBits(session.state.maps[mapId]?.fog.explored[ANA.playerId] ?? '', 12, 10);
    expect((exploredAfter[Math.floor((4 * 12 + 7) / 8)] ?? 0) & (1 << ((4 * 12 + 7) & 7))).not.toBe(0);
  });

  it('applies Human vs Elf Darkvision, carried Torches, Magical Darkness vs Devil Sight, and Daylight', () => {
    const session = setup();
    const views: Record<string, SessionState> = {
      [GM.playerId]: session.viewFor(GM.playerId),
      [ANA.playerId]: session.viewFor(ANA.playerId),
      [BRUNO.playerId]: session.viewFor(BRUNO.playerId),
    };

    applyAndCheckViews(session, GM.playerId, { kind: 'map.create', data: { name: 'Abismo', width: 30, height: 10 } }, views);
    const mapId = Object.keys(session.state.maps)[0] ?? '';
    applyAndCheckViews(session, GM.playerId, { kind: 'lighting.config', data: { mapId, environment: 'interior', timeOfDay: 'night' } }, views);
    applyAndCheckViews(session, GM.playerId, { kind: 'fog.config', data: { mapId, autoEnabled: true, visionFeet: 60, rememberExplored: true } }, views);

    const mirielId = createCharacterFromFixture(session, ANA.playerId, humanCleric.character, views);
    const elariaId = createCharacterFromFixture(session, BRUNO.playerId, elfWizard.character, views);

    applyAndCheckViews(
      session,
      GM.playerId,
      { kind: 'token.create', data: { mapId, name: 'Miriel', characterId: mirielId, position: { x: 2 * WORLD_UNITS_PER_CELL, y: 5 * WORLD_UNITS_PER_CELL }, size: 'medium', ownerIds: [ANA.playerId] } },
      views,
    );
    applyAndCheckViews(
      session,
      GM.playerId,
      { kind: 'token.create', data: { mapId, name: 'Elaria', characterId: elariaId, position: { x: 2 * WORLD_UNITS_PER_CELL, y: 6 * WORLD_UNITS_PER_CELL }, size: 'medium', ownerIds: [BRUNO.playerId] } },
      views,
    );
    // Target near (8, 5) = 30 ft east; Far target at (22, 5) = 100 ft east (> 60 ft Darkvision)
    applyAndCheckViews(
      session,
      GM.playerId,
      { kind: 'token.create', data: { mapId, name: 'Inimigo Perto', position: { x: 8 * WORLD_UNITS_PER_CELL, y: 5 * WORLD_UNITS_PER_CELL }, size: 'medium' } },
      views,
    );
    applyAndCheckViews(
      session,
      GM.playerId,
      { kind: 'token.create', data: { mapId, name: 'Inimigo Longe', position: { x: 22 * WORLD_UNITS_PER_CELL, y: 5 * WORLD_UNITS_PER_CELL }, size: 'medium' } },
      views,
    );

    const mirielTokenId = Object.values(session.state.tokens).find((t) => t.name === 'Miriel')?.id ?? '';
    const elariaTokenId = Object.values(session.state.tokens).find((t) => t.name === 'Elaria')?.id ?? '';
    const nearId = Object.values(session.state.tokens).find((t) => t.name === 'Inimigo Perto')?.id ?? '';
    const farId = Object.values(session.state.tokens).find((t) => t.name === 'Inimigo Longe')?.id ?? '';

    // Total darkness: Human Ana sees neither foreign token and explores 0 cells; Elf Bruno sees near (30 ft <= 60 ft) but not far (100 ft) and even sees Miriel next to him
    expect(views[ANA.playerId]?.tokens[nearId]).toBeUndefined();
    expect(views[ANA.playerId]?.tokens[elariaTokenId]).toBeUndefined();
    expect(hasAnyFogBit(decodeFogBits(session.state.maps[mapId]?.fog.explored[ANA.playerId] ?? '', 30, 10))).toBe(false);
    expect(views[BRUNO.playerId]?.tokens[nearId]).toBeDefined();
    expect(views[BRUNO.playerId]?.tokens[farId]).toBeUndefined();

    // Human lights a carried Torch (20 ft bright + 20 ft dim = 40 ft total): now Ana sees Inimigo Perto (30 ft away) & Elaria!
    applyAndCheckViews(
      session,
      ANA.playerId,
      {
        kind: 'light.add',
        data: {
          mapId,
          light: { name: 'Tocha', kind: 'light', brightFeet: 20, dimFeet: 20, attach: { kind: 'token', tokenId: mirielTokenId } },
        },
      },
      views,
    );
    expect(views[ANA.playerId]?.tokens[nearId]).toBeDefined();
    expect(views[ANA.playerId]?.tokens[elariaTokenId]).toBeDefined();

    // Cast Magical Darkness (level 2, 15 ft) centered at (8.5, 5.5) covering Inimigo Perto: both Ana (torch) and Bruno (Darkvision) lose sight!
    applyAndCheckViews(
      session,
      GM.playerId,
      {
        kind: 'light.add',
        data: {
          mapId,
          light: { name: 'Darkness', kind: 'darkness', darknessFeet: 15, spellLevel: 2, attach: { kind: 'point', x: 8.5, y: 5.5 } },
        },
      },
      views,
    );
    expect(views[ANA.playerId]?.tokens[nearId]).toBeUndefined();
    expect(views[BRUNO.playerId]?.tokens[nearId]).toBeUndefined();

    // Grant Elaria Devil's Sight adjustment -> Elf now sees through Magical Darkness!
    applyAndCheckViews(
      session,
      GM.playerId,
      {
        kind: 'adjustment.add',
        data: {
          characterId: elariaId,
          name: 'Visao Diabolica',
          effects: [{ type: 'grant_sense', sense: 'darkvision', range: 120, magicalDarkness: true }],
        },
      },
      views,
    );
    expect(views[BRUNO.playerId]?.tokens[nearId]).toBeDefined();
    expect(views[ANA.playerId]?.tokens[nearId]).toBeUndefined();

    // Cast level 3 Daylight overlapping Darkness -> Ana sees Inimigo Perto again!
    applyAndCheckViews(
      session,
      GM.playerId,
      {
        kind: 'light.add',
        data: {
          mapId,
          light: { name: 'Daylight', kind: 'light', brightFeet: 30, dimFeet: 30, spellLevel: 3, attach: { kind: 'point', x: 8.5, y: 5.5 } },
        },
      },
      views,
    );
    expect(views[ANA.playerId]?.tokens[nearId]).toBeDefined();
  });

  it('honors configurable sheet vision_range caps, Blinded condition, and Tremorsense through walls', () => {
    const session = setup();
    const views: Record<string, SessionState> = {
      [GM.playerId]: session.viewFor(GM.playerId),
      [ANA.playerId]: session.viewFor(ANA.playerId),
    };

    applyAndCheckViews(session, GM.playerId, { kind: 'map.create', data: { name: 'Planicie', width: 20, height: 10 } }, views);
    const mapId = Object.keys(session.state.maps)[0] ?? '';
    applyAndCheckViews(session, GM.playerId, { kind: 'fog.config', data: { mapId, autoEnabled: true, visionFeet: 60, rememberExplored: true } }, views);

    const mirielId = createCharacterFromFixture(session, ANA.playerId, humanCleric.character, views);
    applyAndCheckViews(
      session,
      GM.playerId,
      { kind: 'token.create', data: { mapId, name: 'Miriel', characterId: mirielId, position: { x: 2 * WORLD_UNITS_PER_CELL, y: 5 * WORLD_UNITS_PER_CELL }, size: 'medium', ownerIds: [ANA.playerId] } },
      views,
    );
    applyAndCheckViews(
      session,
      GM.playerId,
      { kind: 'token.create', data: { mapId, name: 'Batedor', position: { x: 7 * WORLD_UNITS_PER_CELL, y: 5 * WORLD_UNITS_PER_CELL }, size: 'medium' } },
      views,
    );
    const scoutId = Object.values(session.state.tokens).find((t) => t.name === 'Batedor')?.id ?? '';
    expect(views[ANA.playerId]?.tokens[scoutId]).toBeDefined();

    // Cap normal sight to 15 ft -> Scout 25 ft away vanishes
    applyAndCheckViews(
      session,
      GM.playerId,
      {
        kind: 'adjustment.add',
        data: { characterId: mirielId, name: 'Neblina densa', effects: [{ type: 'vision_range', mode: 'cap', range: 15 }] },
      },
      views,
    );
    expect(views[ANA.playerId]?.tokens[scoutId]).toBeUndefined();

    // Raise cap to 60 ft -> Scout reappears; Blinded hides it again; removing Blinded brings it back
    applyAndCheckViews(
      session,
      GM.playerId,
      {
        kind: 'adjustment.add',
        data: { characterId: mirielId, name: 'Tremorsense', effects: [{ type: 'grant_sense', sense: 'tremorsense', range: 30 }] },
      },
      views,
    );
    expect(views[ANA.playerId]?.tokens[scoutId]).toBeDefined();

    // Put a wall right between Miriel and Scout (at x=4.5); Tremorsense still detects Scout behind the wall,
    // even when Blinded, without exploring cells behind x=4.5!
    applyAndCheckViews(
      session,
      GM.playerId,
      { kind: 'wall.add', data: { mapId, walls: [{ x1: 4.5, y1: 0, x2: 4.5, y2: 10, kind: 'wall' }] } },
      views,
    );
    applyAndCheckViews(
      session,
      GM.playerId,
      { kind: 'fog.memory.clear', data: { mapId } },
      views,
    );
    applyAndCheckViews(
      session,
      GM.playerId,
      { kind: 'condition.add', data: { target: { characterId: mirielId }, condition: 'blinded' } },
      views,
    );
    expect(views[ANA.playerId]?.tokens[scoutId]).toBeDefined();
    expect(hasAnyFogBit(decodeFogBits(session.state.maps[mapId]?.fog.explored[ANA.playerId] ?? '', 20, 10))).toBe(false);

    // Removing blinded restores normal exploration on the viewer's side of the wall only
    applyAndCheckViews(
      session,
      GM.playerId,
      { kind: 'condition.remove', data: { target: { characterId: mirielId }, condition: 'blinded' } },
      views,
    );
    const explored = decodeFogBits(session.state.maps[mapId]?.fog.explored[ANA.playerId] ?? '', 20, 10);
    expect((explored[Math.floor((5 * 20 + 2) / 8)] ?? 0) & (1 << ((5 * 20 + 2) & 7))).not.toBe(0);
    expect((explored[Math.floor((5 * 20 + 7) / 8)] ?? 0) & (1 << ((5 * 20 + 7) & 7))).toBe(0);
  });

  it('uses baked 3D map torches for visibility and hides tokens when a player extinguishes the torch at runtime', () => {
    const sewerDoc: unknown = JSON.parse(readFileSync(join(process.cwd(), 'maps', 'grand-undercity-sewers.vttmap.json'), 'utf8'));
    const propLights = extractPropLightsFrom3dMapDocument(sewerDoc);
    const session = setup(sewerDoc);
    const views: Record<string, SessionState> = {
      [GM.playerId]: session.viewFor(GM.playerId),
      [ANA.playerId]: session.viewFor(ANA.playerId),
    };

    applyAndCheckViews(
      session,
      GM.playerId,
      { kind: 'map.create', data: { name: 'Esgotos', width: 72, height: 60, scene3d: SEWER_SHA } },
      views,
    );
    const mapId = Object.keys(session.state.maps)[0] ?? '';
    const map = session.state.maps[mapId];
    if (!map) throw new Error('Expected sewer map');

    // Pick a surface torch that has clear LOS and no other baked prop light illuminating the target cell
    const chosenTorch = propLights.find((p) => {
      if (p.layer !== 'surface' || p.x < 4 || p.x > 68 || p.y < 4 || p.y > 56) return false;
      const obsX = Math.floor(p.x + 1) + 0.5;
      const obsY = Math.floor(p.y) + 0.5;
      const tgtX = Math.floor(p.x - 2) + 0.5;
      const tgtY = Math.floor(p.y) + 0.5;
      const tgtBlockedByOther = propLights.some(
        (other) =>
          other.id !== p.id &&
          Math.hypot(other.x - tgtX, other.y - tgtY) * 5 <= other.brightFeet + other.dimFeet + 5,
      );
      if (tgtBlockedByOther) return false;
      return (
        hasLineOfSight2D({ x: p.x, y: p.y }, { x: obsX, y: obsY }, map.walls) &&
        hasLineOfSight2D({ x: p.x, y: p.y }, { x: tgtX, y: tgtY }, map.walls) &&
        hasLineOfSight2D({ x: obsX, y: obsY }, { x: tgtX, y: tgtY }, map.walls)
      );
    });
    expect(chosenTorch).toBeDefined();
    if (!chosenTorch) return;

    applyAndCheckViews(session, GM.playerId, { kind: 'fog.config', data: { mapId, autoEnabled: true, visionFeet: 60, rememberExplored: true } }, views);

    const mirielId = createCharacterFromFixture(session, ANA.playerId, humanCleric.character, views);
    const obsCellX = Math.floor(chosenTorch.x + 1);
    const obsCellY = Math.floor(chosenTorch.y);
    const tgtCellX = Math.floor(chosenTorch.x - 2);
    const tgtCellY = Math.floor(chosenTorch.y);

    applyAndCheckViews(
      session,
      GM.playerId,
      {
        kind: 'token.create',
        data: { mapId, name: 'Miriel', characterId: mirielId, position: { x: obsCellX * WORLD_UNITS_PER_CELL, y: obsCellY * WORLD_UNITS_PER_CELL }, size: 'medium', ownerIds: [ANA.playerId] },
      },
      views,
    );
    applyAndCheckViews(
      session,
      GM.playerId,
      {
        kind: 'token.create',
        data: { mapId, name: 'Rato', position: { x: tgtCellX * WORLD_UNITS_PER_CELL, y: tgtCellY * WORLD_UNITS_PER_CELL }, size: 'medium' },
      },
      views,
    );
    const ratId = Object.values(session.state.tokens).find((t) => t.name === 'Rato')?.id ?? '';

    // Miriel has NO darkvision and no carried light, yet sees Rato thanks to the baked 3D torch
    expect(views[ANA.playerId]?.tokens[ratId]).toBeDefined();

    // Extinguish that 3D torch at runtime without editing scene3d -> Rato plunges into darkness and disappears via patch
    applyAndCheckViews(
      session,
      ANA.playerId,
      { kind: 'map_prop_light.set', data: { mapId, propLightId: chosenTorch.id, state: 'off' } },
      views,
    );
    expect(session.state.maps[mapId]?.scene3d).toBe(SEWER_SHA);
    expect(views[ANA.playerId]?.tokens[ratId]).toBeUndefined();
  });

  it('resolves character, monster, and fallback tokenVisionProfiles for IPC consumers', () => {
    const monsterWithSenses = compendium.creatures.find((c) =>
      [...c.effects, ...c.traits.flatMap((t) => t.effects)].some((e) => e.type === 'grant_sense'),
    );
    expect(monsterWithSenses).toBeDefined();
    if (!monsterWithSenses) return;

    const session = setup();
    session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Arena', width: 10, height: 10 } });
    const mapId = Object.keys(session.state.maps)[0] ?? '';
    const views: Record<string, SessionState> = { [GM.playerId]: session.viewFor(GM.playerId) };
    const elariaId = createCharacterFromFixture(session, BRUNO.playerId, elfWizard.character, views);

    session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Elaria', characterId: elariaId, position: { x: 0, y: 0 }, size: 'medium', ownerIds: [BRUNO.playerId] } });
    session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: monsterWithSenses.name, monsterId: monsterWithSenses.id, position: { x: WORLD_UNITS_PER_CELL, y: 0 }, size: monsterWithSenses.size[0] ?? 'medium' } });
    session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Caixa', position: { x: 2 * WORLD_UNITS_PER_CELL, y: 0 }, size: 'medium' } });

    const elariaTokenId = Object.values(session.state.tokens).find((t) => t.name === 'Elaria')?.id ?? '';
    const monsterTokenId = Object.values(session.state.tokens).find((t) => t.monsterId === monsterWithSenses.id)?.id ?? '';
    const fallbackTokenId = Object.values(session.state.tokens).find((t) => t.name === 'Caixa')?.id ?? '';

    const profiles = resolveAllTokenVisionProfiles(session.state, session.deps);
    expect(profiles[elariaTokenId]?.darkvisionFeet).toBe(60);
    expect(profiles[fallbackTokenId]?.normalRangeFeet).toBe(session.state.maps[mapId]?.fog.visionFeet);

    const mp = profiles[monsterTokenId];
    expect(mp).toBeDefined();
    const hasSpecialSense = (mp?.darkvisionFeet ?? 0) > 0 || (mp?.blindsightFeet ?? 0) > 0 || (mp?.tremorsenseFeet ?? 0) > 0 || (mp?.truesightFeet ?? 0) > 0;
    expect(hasSpecialSense).toBe(true);
  });
});
