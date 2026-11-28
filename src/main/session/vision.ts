import { creatureVisionProfile, deriveVisionProfile, type VisionProfile } from 'rules-engine/vision';
import {
  DEFAULT_VISION_FEET,
  extractHeightfieldFromMapDoc,
  extractPropLightsFrom3dMapDocument,
  type ExtractedPropLight,
  type GameMap,
  type SessionCharacter,
  type SessionState,
  type TerrainHeightfield,
  type Token,
} from '../../shared/protocol';
import type { SessionDeps } from './context';

/**
 * Resolução de `VisionProfile` por token (lendo ficha de personagem, bloco de monstro
 * ou condições) e cache imutável de documentos 3D por SHA-256 (nota 0081).
 */

export interface Scene3dVisionData {
  readonly heightfield: TerrainHeightfield | null;
  readonly bakedPropLights: readonly ExtractedPropLight[];
}

const EMPTY_SCENE: Scene3dVisionData = { heightfield: null, bakedPropLights: [] };

export interface SessionVisionResolver {
  profileFor(state: SessionState, token: Token, map: GameMap): VisionProfile;
  sceneFor(map: GameMap): Scene3dVisionData;
}

export function isTokenControlledBy(
  token: { readonly ownerIds: readonly string[]; readonly characterId: string | null },
  characters: Readonly<Record<string, SessionCharacter>>,
  playerId: string,
): boolean {
  if (token.ownerIds.includes(playerId)) return true;
  return token.characterId !== null && characters[token.characterId]?.ownerId === playerId;
}

export function resolveTokenVisionProfile(
  state: Pick<SessionState, 'characters'>,
  token: Pick<Token, 'characterId' | 'monsterId' | 'conditions' | 'visionFeet'>,
  deps: Pick<SessionDeps, 'characterSheet' | 'creature'>,
  defaultVisionFeet: number,
): VisionProfile {
  if (token.characterId !== null) {
    const character = state.characters[token.characterId];
    if (character) {
      const sheet = deps.characterSheet(character);
      if (sheet) {
        if (token.visionFeet !== null && !sheet.vision.blinded) {
          return { ...sheet.vision, normalRangeFeet: token.visionFeet };
        }
        return sheet.vision;
      }
      const activeConditions = character.conditions.active.map((c) => c.condition);
      const base = deriveVisionProfile([], activeConditions);
      if (!base.blinded) {
        return { ...base, normalRangeFeet: token.visionFeet ?? defaultVisionFeet };
      }
      return base;
    }
  }

  const tokenConditions = token.conditions.active.map((c) => c.condition);
  if (token.monsterId !== null) {
    const creature = deps.creature(token.monsterId);
    if (creature) {
      const profile = creatureVisionProfile(creature, tokenConditions);
      if (token.visionFeet !== null && !profile.blinded) {
        return { ...profile, normalRangeFeet: token.visionFeet };
      }
      return profile;
    }
  }

  const fallback = deriveVisionProfile([], tokenConditions);
  if (!fallback.blinded) {
    return { ...fallback, normalRangeFeet: token.visionFeet ?? defaultVisionFeet };
  }
  return fallback;
}

/** Cria um resolvedor com cache em memória dos mapas 3D (indexado por SHA-256 imutável). */
export function createSessionVisionResolver(
  deps: Pick<SessionDeps, 'characterSheet' | 'creature' | 'readAsset'>,
): SessionVisionResolver {
  const sceneCache = new Map<string, Scene3dVisionData>();

  const sceneFor = (map: Pick<GameMap, 'scene3d'>): Scene3dVisionData => {
    if (map.scene3d === null || !deps.readAsset) return EMPTY_SCENE;
    const cached = sceneCache.get(map.scene3d);
    if (cached) return cached;

    const bytes = deps.readAsset(map.scene3d);
    if (!bytes) {
      sceneCache.set(map.scene3d, EMPTY_SCENE);
      return EMPTY_SCENE;
    }
    try {
      const doc = JSON.parse(bytes.toString('utf8')) as unknown;
      const data: Scene3dVisionData = {
        heightfield: extractHeightfieldFromMapDoc(doc),
        bakedPropLights: extractPropLightsFrom3dMapDocument(doc),
      };
      sceneCache.set(map.scene3d, data);
      return data;
    } catch {
      sceneCache.set(map.scene3d, EMPTY_SCENE);
      return EMPTY_SCENE;
    }
  };

  const profileFor = (state: SessionState, token: Token, map: GameMap): VisionProfile =>
    resolveTokenVisionProfile(state, token, deps, map.fog.visionFeet);

  return { profileFor, sceneFor };
}

/** Resolve os perfis de visão atuais de todos os tokens presentes no estado (para IPC e tela). */
export function resolveAllTokenVisionProfiles(
  state: SessionState,
  deps: Pick<SessionDeps, 'characterSheet' | 'creature'>,
): Record<string, VisionProfile> {
  const out: Record<string, VisionProfile> = {};
  for (const token of Object.values(state.tokens)) {
    const map = state.maps[token.mapId];
    const fallbackFeet = map?.fog.visionFeet ?? DEFAULT_VISION_FEET;
    out[token.id] = resolveTokenVisionProfile(state, token, deps, fallbackFeet);
  }
  return out;
}
