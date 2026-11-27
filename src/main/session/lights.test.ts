import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSrdCompendium, seededRng } from 'rules-engine';
import { CharacterSchema } from 'rules-engine/schemas';
import { describe, expect, it } from 'vitest';
import goliathWarlock from '../../../packages/rules-engine/tests/fixtures/goliath-warlock-5.json';
import { characterSheet } from '../character-sheet';
import {
  applyPatch,
  extractPropLightsFrom3dMapDocument,
  type Intent,
  type SessionState,
  SessionStateSchema,
  WORLD_UNITS_PER_CELL,
} from '../../shared/protocol';
import { HostSession } from './executor';

const compendium = loadSrdCompendium();
const CAMPAIGN = { id: randomUUID(), name: 'A Mina Perdida' };
const GM = { playerId: randomUUID(), displayName: 'Mestre' };
const ANA = { playerId: randomUUID(), displayName: 'Ana' };
const BRUNO = { playerId: randomUUID(), displayName: 'Bruno' };
const SEWER_SHA = 'd'.repeat(64);

function setup(sewerDoc?: unknown): HostSession {
  const session = new HostSession(CAMPAIGN, GM, {
    rng: seededRng(1),
    now: () => 1763769600000,
    newId: randomUUID,
    monsterExists: () => false,
    pruneSteps: (steps) => steps,
    itemProblems: () => [],
    characterSheet: (c) => characterSheet(c, compendium).sheet ?? undefined,
    monsterHpMax: () => undefined,
    creature: () => undefined,
    spell: (id) => compendium.spells.find((s) => s.id === id),
    assetExists: (sha) => sha === SEWER_SHA && sewerDoc !== undefined,
    readAsset: (sha) => (sha === SEWER_SHA && sewerDoc !== undefined ? Buffer.from(JSON.stringify(sewerDoc), 'utf8') : undefined),
  });
  session.connect(ANA);
  session.connect(BRUNO);
  return session;
}

describe('HostSession: dynamic lighting, carried lights, spells, and map torch overrides', () => {
  it('configures environment/timeOfDay (GM only) and manages placed/carried lights with permissions', () => {
    const session = setup();
    session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Floresta', width: 12, height: 12 } });
    const mapId = Object.keys(session.state.maps)[0] ?? '';
    session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Ana', position: { x: 2 * WORLD_UNITS_PER_CELL, y: 2 * WORLD_UNITS_PER_CELL }, size: 'medium', ownerIds: [ANA.playerId] } });
    session.handle(GM.playerId, { kind: 'token.create', data: { mapId, name: 'Bruno', position: { x: 8 * WORLD_UNITS_PER_CELL, y: 8 * WORLD_UNITS_PER_CELL }, size: 'medium', ownerIds: [BRUNO.playerId] } });
    const anaTokenId = Object.values(session.state.tokens).find((t) => t.name === 'Ana')?.id ?? '';
    const brunoTokenId = Object.values(session.state.tokens).find((t) => t.name === 'Bruno')?.id ?? '';

    const playerLighting = session.handle(ANA.playerId, { kind: 'lighting.config', data: { mapId, environment: 'interior' } });
    expect(playerLighting.result.status).toBe('rejected');
    if (playerLighting.result.status === 'rejected') expect(playerLighting.result.code).toBe('not_allowed');

    expect(
      session.handle(GM.playerId, { kind: 'lighting.config', data: { mapId, environment: 'exterior', timeOfDay: 'night' } }).result.status,
    ).toBe('applied');
    expect(session.state.maps[mapId]?.lighting).toEqual({ environment: 'exterior', timeOfDay: 'night', ambientOverride: null });

    // Ana cannot attach a light to Bruno's token
    const badAttach = session.handle(ANA.playerId, {
      kind: 'light.add',
      data: { mapId, light: { name: 'Tocha', kind: 'light', attach: { kind: 'token', tokenId: brunoTokenId } } },
    });
    expect(badAttach.result.status).toBe('rejected');

    let anaView: SessionState = session.viewFor(ANA.playerId);
    const apply = (actorId: string, intent: Intent) => {
      const out = session.handle(actorId, intent);
      expect(out.result.status).toBe('applied');
      expect(SessionStateSchema.safeParse(session.state).success).toBe(true);
      if (out.change) {
        anaView = applyPatch(anaView, session.patchFor(out.change, ANA.playerId).ops);
        expect(anaView).toEqual(session.viewFor(ANA.playerId));
      }
    };

    // Ana carries a Bullseye Lantern on her own token
    apply(ANA.playerId, {
      kind: 'light.add',
      data: {
        mapId,
        light: {
          name: 'Lanterna Alvo',
          kind: 'light',
          brightFeet: 60,
          dimFeet: 60,
          angleDeg: 60,
          directionDeg: 90,
          attach: { kind: 'token', tokenId: anaTokenId },
        },
      },
    });
    const lanternId = session.state.maps[mapId]?.lights[0]?.id ?? '';
    expect(session.state.maps[mapId]?.lights[0]).toMatchObject({ angleDeg: 60, directionDeg: 90, enabled: true });

    // Bruno cannot toggle or remove Ana's lantern
    expect(session.handle(BRUNO.playerId, { kind: 'light.toggle', data: { mapId, lightId: lanternId } }).result.status).toBe('rejected');
    expect(session.handle(BRUNO.playerId, { kind: 'light.remove', data: { mapId, lightId: lanternId } }).result.status).toBe('rejected');

    // Ana rotates and toggles her lantern
    apply(ANA.playerId, { kind: 'light.update', data: { mapId, lightId: lanternId, directionDeg: 180 } });
    expect(session.state.maps[mapId]?.lights[0]?.directionDeg).toBe(180);
    apply(ANA.playerId, { kind: 'light.toggle', data: { mapId, lightId: lanternId } });
    expect(session.state.maps[mapId]?.lights[0]?.enabled).toBe(false);

    // Removing Ana's token removes lights attached to it
    apply(GM.playerId, { kind: 'token.remove', data: { tokenId: anaTokenId } });
    expect(session.state.maps[mapId]?.lights.length).toBe(0);
  });

  it('clears spell-linked Darkness zones automatically when Concentration ends', () => {
    const session = setup();
    session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Arena', width: 10, height: 10 } });
    const mapId = Object.keys(session.state.maps)[0] ?? '';

    const warlockParsed = CharacterSchema.parse(goliathWarlock.character);
    session.handle(GM.playerId, { kind: 'character.create', data: { name: 'Bruxo', ownerId: ANA.playerId } });
    const charId = Object.keys(session.state.characters)[0] ?? '';
    session.handle(GM.playerId, {
      kind: 'character.update',
      data: { characterId: charId, baseScores: warlockParsed.baseScores, steps: warlockParsed.steps },
    });

    // Concentrate on a concentration spell (Darkness or Hex) and attach a Darkness zone linked to it
    const warlockChar = session.state.characters[charId];
    const sheet = warlockChar ? session.deps.characterSheet(warlockChar) : undefined;
    const concSpellId = sheet?.spellcasting.concentration[0];
    expect(concSpellId).toBeDefined();
    if (!concSpellId) return;

    expect(session.handle(ANA.playerId, { kind: 'concentration.set', data: { characterId: charId, spellId: concSpellId } }).result.status).toBe('applied');
    expect(
      session.handle(ANA.playerId, {
        kind: 'light.add',
        data: {
          mapId,
          light: {
            name: 'Darkness',
            kind: 'darkness',
            darknessFeet: 15,
            spellLevel: 2,
            attach: { kind: 'point', x: 5, y: 5 },
            spell: { characterId: charId, spellId: concSpellId },
          },
        },
      }).result.status,
    ).toBe('applied');
    expect(session.state.maps[mapId]?.lights.length).toBe(1);

    // Ending concentration automatically removes the Darkness zone
    expect(session.handle(ANA.playerId, { kind: 'concentration.end', data: { characterId: charId } }).result.status).toBe('applied');
    expect(session.state.maps[mapId]?.lights.length).toBe(0);
  });

  it('controls existing 3D map torches on the fly without editing scene3d', () => {
    const sewerDoc: unknown = JSON.parse(readFileSync(join(process.cwd(), 'maps', 'grand-undercity-sewers.vttmap.json'), 'utf8'));
    const extracted = extractPropLightsFrom3dMapDocument(sewerDoc);
    expect(extracted.length).toBeGreaterThan(5);
    const firstTorch = extracted[0];
    if (!firstTorch) throw new Error('Expected at least one extracted prop light');

    const session = setup(sewerDoc);
    expect(session.handle(GM.playerId, { kind: 'map.create', data: { name: 'Sewers', width: 72, height: 60, scene3d: SEWER_SHA } }).result.status).toBe('applied');
    const mapId = Object.keys(session.state.maps)[0] ?? '';
    expect(session.state.maps[mapId]?.lighting).toEqual({ environment: 'interior', timeOfDay: 'night', ambientOverride: null });

    // Place Ana far away -> rejected; move near -> can turn off; GM can remove & relight without touching scene3d
    session.handle(GM.playerId, {
      kind: 'token.create',
      data: { mapId, name: 'Ana', position: { x: 0, y: 0 }, size: 'medium', ownerIds: [ANA.playerId] },
    });
    const anaTokenId = Object.values(session.state.tokens)[0]?.id ?? '';

    const farAttempt = session.handle(ANA.playerId, {
      kind: 'map_prop_light.set',
      data: { mapId, propLightId: firstTorch.id, state: 'off' },
    });
    expect(farAttempt.result.status).toBe('rejected');
    if (farAttempt.result.status === 'rejected') expect(farAttempt.result.code).toBe('not_allowed');

    const nearX = Math.max(0, Math.round(firstTorch.x) - 1) * WORLD_UNITS_PER_CELL;
    const nearY = Math.max(0, Math.round(firstTorch.y) - 1) * WORLD_UNITS_PER_CELL;
    expect(session.handle(GM.playerId, { kind: 'token.move', data: { tokenId: anaTokenId, to: { x: nearX, y: nearY } } }).result.status).toBe('applied');

    expect(
      session.handle(ANA.playerId, { kind: 'map_prop_light.set', data: { mapId, propLightId: firstTorch.id, state: 'off' } }).result.status,
    ).toBe('applied');
    expect(session.state.maps[mapId]?.propLightOverrides[firstTorch.id]).toBe('off');
    expect(session.state.maps[mapId]?.scene3d).toBe(SEWER_SHA);

    expect(
      session.handle(GM.playerId, { kind: 'map_prop_light.set', data: { mapId, propLightId: firstTorch.id, state: 'removed' } }).result.status,
    ).toBe('applied');
    expect(session.state.maps[mapId]?.propLightOverrides[firstTorch.id]).toBe('removed');

    expect(
      session.handle(GM.playerId, { kind: 'map_prop_light.set', data: { mapId, propLightId: firstTorch.id, state: 'on' } }).result.status,
    ).toBe('applied');
    expect(session.state.maps[mapId]?.propLightOverrides[firstTorch.id]).toBeUndefined();
  });
});
