import { deriveVisionProfile, type LightLevel, type PerceptionKind, type VisionProfile } from 'rules-engine/vision';
import {
  computeMapLightGrid,
  computePlayerVisionGrid,
  computeTokenVisionGrid,
  decodeFogBits,
  emptyFogBits,
  type ExtractedPropLight,
  type FogCell,
  type GameMap,
  getFogCell,
  LIGHT_CODE_BRIGHT,
  LIGHT_CODE_DARKNESS,
  LIGHT_CODE_DIM,
  LIGHT_CODE_MAGICAL_DARKNESS,
  type MapLightGrid,
  mergeVisionGrids,
  PERCEPTION_CODE_BRIGHT_COLOR,
  PERCEPTION_CODE_DARKVISION_BW,
  PERCEPTION_CODE_DIM_COLOR,
  PERCEPTION_CODE_SENSE_ONLY,
  PERCEPTION_CODE_UNSEEN,
  type Point,
  type Role,
  type SessionCharacter,
  type TerrainHeightfield,
  type Token,
  unionFogBits,
  type VisionGrid,
  WORLD_UNITS_PER_CELL,
} from '../../../shared/protocol';

/**
 * Renderização da névoa de guerra e máscara de percepção/iluminação 2D (notas 0059 e 0081),
 * desacoplada do PixiJS: preenche buffers RGBA de 1 pixel por célula (`width × height`)
 * ou alimenta o compositor suave por polígonos.
 */

export type FogTool = 'none' | 'brush-cover' | 'brush-reveal' | 'rect-cover' | 'rect-reveal';

export interface FogViewer {
  role: Role;
  playerId: string;
  /** Quando o mestre seleciona um token, pré-visualiza a visão e o mapa desbloqueado daquele token. */
  previewTokenId?: string | null;
}

export interface FogRenderOptions {
  readonly visionProfiles?: Readonly<Record<string, VisionProfile>>;
  readonly characters?: Readonly<Record<string, SessionCharacter>>;
  readonly bakedPropLights?: readonly ExtractedPropLight[];
  readonly heightfield?: TerrainHeightfield | null;
}

const RGBA_CLEAR = [0, 0, 0, 0] as const;
/** Névoa opaca (invisível/preto) para células nunca vistas ou sob névoa manual. */
const RGBA_PLAYER_OPAQUE = [8, 7, 14, 255] as const;
/** Véu escuro (semitransparente) para células já vistas antes, fora da visão atual. */
const RGBA_PLAYER_EXPLORED = [8, 7, 14, 145] as const;
/** Névoa manual vista pelo mestre no modo geral (semitransparente em índigo para o mestre continuar vendo o mapa). */
const RGBA_GM_MANUAL = [22, 16, 52, 155] as const;
/** Área fora da visão de todos os jogadores vista pelo mestre no modo geral (véu leve). */
const RGBA_GM_AUTO = [8, 7, 14, 70] as const;

/** Canais da máscara do filtro `VisionLightingFilter`: `(desaturate, brightness, veilTint, fogFill)`. */
export const MASK_BRIGHT = [0, 255, 0, 0] as const;
export const MASK_DIM = [0, 165, 0, 0] as const;
export const MASK_DARKVISION_BW = [255, 198, 40, 0] as const;
export const MASK_SENSE_ONLY = [220, 132, 110, 0] as const;
export const MASK_EXPLORED = [170, 82, 0, 0] as const;
export const MASK_UNSEEN = [0, 0, 0, 255] as const;
export const MASK_GM_PREVIEW_MANUAL = [0, 0, 90, 255] as const;
export const MASK_GM_MANUAL = [40, 140, 200, 130] as const;
export const MASK_GM_MAGICAL_DARKNESS = [40, 110, 185, 95] as const;
export const MASK_GM_DARKNESS = [0, 155, 0, 45] as const;
export const MASK_GM_DIM = [0, 210, 0, 0] as const;
export const MASK_GM_AUTO_OUTSIDE = [30, 165, 0, 50] as const;
export const MASK_DARKNESS_UNLIT = [0, 120, 0, 0] as const;

export function writePixel(data: Uint8ClampedArray, offset: number, rgba: readonly [number, number, number, number]): void {
  data[offset] = rgba[0];
  data[offset + 1] = rgba[1];
  data[offset + 2] = rgba[2];
  data[offset + 3] = rgba[3];
}

export function isViewerObserverToken(
  token: { readonly ownerIds: readonly string[]; readonly characterId: string | null },
  viewerPlayerId: string,
  characters?: Readonly<Record<string, SessionCharacter>>,
): boolean {
  if (token.ownerIds.includes(viewerPlayerId)) return true;
  return token.characterId !== null && characters?.[token.characterId]?.ownerId === viewerPlayerId;
}

export function isPlayerOwnedToken(
  token: { readonly ownerIds: readonly string[]; readonly characterId: string | null },
  characters?: Readonly<Record<string, SessionCharacter>>,
): boolean {
  return token.ownerIds.length > 0 || (token.characterId !== null && characters?.[token.characterId] !== undefined);
}

export function resolveRendererTokenProfile(
  token: Pick<Token, 'id' | 'characterId' | 'conditions' | 'visionFeet'>,
  map: Pick<GameMap, 'fog'>,
  options?: Pick<FogRenderOptions, 'visionProfiles' | 'characters'>,
): VisionProfile {
  const fromIpc = options?.visionProfiles?.[token.id];
  if (fromIpc) return fromIpc;

  const charConditions =
    token.characterId !== null ? options?.characters?.[token.characterId]?.conditions.active : undefined;
  const activeConditions = (charConditions ?? token.conditions.active).map((c) => c.condition);
  const base = deriveVisionProfile([], activeConditions);
  if (!base.blinded) {
    return { ...base, normalRangeFeet: token.visionFeet ?? map.fog.visionFeet };
  }
  return base;
}

export function maskRgbaForPerceptionCode(
  code: number,
  explored: boolean,
  unseenFallback: readonly [number, number, number, number],
): readonly [number, number, number, number] {
  switch (code) {
    case PERCEPTION_CODE_BRIGHT_COLOR:
      return MASK_BRIGHT;
    case PERCEPTION_CODE_DIM_COLOR:
      return MASK_DIM;
    case PERCEPTION_CODE_DARKVISION_BW:
      return MASK_DARKVISION_BW;
    case PERCEPTION_CODE_SENSE_ONLY:
      return MASK_SENSE_ONLY;
    case PERCEPTION_CODE_UNSEEN:
    default:
      return explored ? MASK_EXPLORED : unseenFallback;
  }
}

export function maskRgbaForGmLightCode(lightCode: number): readonly [number, number, number, number] {
  switch (lightCode) {
    case LIGHT_CODE_BRIGHT:
      return MASK_BRIGHT;
    case LIGHT_CODE_DIM:
      return MASK_GM_DIM;
    case LIGHT_CODE_MAGICAL_DARKNESS:
      return MASK_GM_MAGICAL_DARKNESS;
    case LIGHT_CODE_DARKNESS:
    default:
      return MASK_GM_DARKNESS;
  }
}

export function maskRgbaForUnfoggedLightCode(lightCode: number): readonly [number, number, number, number] {
  switch (lightCode) {
    case LIGHT_CODE_BRIGHT:
      return MASK_BRIGHT;
    case LIGHT_CODE_DIM:
      return MASK_DIM;
    case LIGHT_CODE_MAGICAL_DARKNESS:
      return MASK_UNSEEN;
    case LIGHT_CODE_DARKNESS:
    default:
      return MASK_DARKNESS_UNLIT;
  }
}

export function lightLevelLabelCode(level: LightLevel): number {
  switch (level) {
    case 'bright':
      return LIGHT_CODE_BRIGHT;
    case 'dim':
      return LIGHT_CODE_DIM;
    case 'magical_darkness':
      return LIGHT_CODE_MAGICAL_DARKNESS;
    case 'darkness':
    default:
      return LIGHT_CODE_DARKNESS;
  }
}

export function perceptionLabelRank(kind: PerceptionKind): number {
  switch (kind) {
    case 'bright_color':
      return PERCEPTION_CODE_BRIGHT_COLOR;
    case 'dim_color':
      return PERCEPTION_CODE_DIM_COLOR;
    case 'darkvision_bw':
      return PERCEPTION_CODE_DARKVISION_BW;
    case 'sense_only':
      return PERCEPTION_CODE_SENSE_ONLY;
    case 'unseen':
    default:
      return PERCEPTION_CODE_UNSEEN;
  }
}

function buildExploredBitsForToken(
  token: Token,
  map: GameMap,
  characters?: Readonly<Record<string, SessionCharacter>>,
): Uint8Array | null {
  if (!map.fog.autoEnabled || !map.fog.rememberExplored) return null;
  const keys = new Set<string>(token.ownerIds);
  const charOwner = token.characterId !== null ? characters?.[token.characterId]?.ownerId : undefined;
  if (charOwner) keys.add(charOwner);
  if (keys.size === 0) keys.add(token.id);

  let merged = emptyFogBits(map.width, map.height);
  let hasAny = false;
  for (const key of keys) {
    const encoded = map.fog.explored[key];
    if (encoded !== undefined) {
      merged = unionFogBits(merged, decodeFogBits(encoded, map.width, map.height));
      hasAny = true;
    }
  }
  return hasAny ? merged : null;
}

function computeAllPlayersGrid(
  map: GameMap,
  tokens: readonly Token[],
  lightGrid: MapLightGrid,
  manualFogBits: Uint8Array,
  options?: FogRenderOptions,
): VisionGrid {
  const grids: VisionGrid[] = [];
  for (const t of tokens) {
    if (t.mapId !== map.id || !isPlayerOwnedToken(t, options?.characters)) continue;
    grids.push(
      computeTokenVisionGrid(map, t, resolveRendererTokenProfile(t, map, options), lightGrid, {
        manualFogBits,
        ...(options?.heightfield !== undefined ? { heightfield: options.heightfield } : {}),
      }),
    );
  }
  return mergeVisionGrids(map.width, map.height, 'surface', grids);
}

/** Preenche `data` (`width * height * 4` bytes RGBA) com a névoa vista por `viewer` usando o solver ocluído. */
export function fillFogImageData(
  data: Uint8ClampedArray,
  map: GameMap,
  tokens: readonly Token[],
  viewer: FogViewer,
  options?: FogRenderOptions,
): void {
  const { width, height, fog } = map;
  const manual = decodeFogBits(fog.manual, width, height);
  const lightGrid = computeMapLightGrid(map, tokens, {
    ...(options?.bakedPropLights ? { bakedPropLights: options.bakedPropLights } : {}),
    ...(options?.heightfield !== undefined ? { heightfield: options.heightfield } : {}),
  });

  if (viewer.role === 'gm') {
    const previewToken =
      viewer.previewTokenId !== undefined && viewer.previewTokenId !== null
        ? tokens.find((t) => t.id === viewer.previewTokenId && t.mapId === map.id)
        : undefined;

    if (previewToken) {
      const vision = fog.autoEnabled
        ? computeTokenVisionGrid(map, previewToken, resolveRendererTokenProfile(previewToken, map, options), lightGrid, {
            manualFogBits: manual,
            ...(options?.heightfield !== undefined ? { heightfield: options.heightfield } : {}),
          }).seenBits
        : null;
      const explored = buildExploredBitsForToken(previewToken, map, options?.characters);

      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          const offset = (row * width + col) * 4;
          if (getFogCell(manual, width, col, row)) {
            writePixel(data, offset, RGBA_PLAYER_OPAQUE);
          } else if (vision) {
            if (getFogCell(vision, width, col, row)) {
              writePixel(data, offset, RGBA_CLEAR);
            } else if (explored && getFogCell(explored, width, col, row)) {
              writePixel(data, offset, RGBA_PLAYER_EXPLORED);
            } else {
              writePixel(data, offset, RGBA_PLAYER_OPAQUE);
            }
          } else {
            writePixel(data, offset, RGBA_CLEAR);
          }
        }
      }
      return;
    }

    const anyVision = fog.autoEnabled ? computeAllPlayersGrid(map, tokens, lightGrid, manual, options).seenBits : null;
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const offset = (row * width + col) * 4;
        if (getFogCell(manual, width, col, row)) {
          writePixel(data, offset, RGBA_GM_MANUAL);
        } else if (anyVision && !getFogCell(anyVision, width, col, row)) {
          writePixel(data, offset, RGBA_GM_AUTO);
        } else {
          writePixel(data, offset, RGBA_CLEAR);
        }
      }
    }
    return;
  }

  const vision = fog.autoEnabled
    ? computePlayerVisionGrid(
        map,
        tokens,
        (t) => resolveRendererTokenProfile(t as Token, map, options),
        (t) => isViewerObserverToken(t, viewer.playerId, options?.characters),
        {
          lightGrid,
          manualFogBits: manual,
          ...(options?.heightfield !== undefined ? { heightfield: options.heightfield } : {}),
        },
      ).seenBits
    : null;
  const exploredBase64 = fog.autoEnabled && fog.rememberExplored ? fog.explored[viewer.playerId] : undefined;
  const explored = exploredBase64 !== undefined ? decodeFogBits(exploredBase64, width, height) : null;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const offset = (row * width + col) * 4;
      if (getFogCell(manual, width, col, row)) {
        writePixel(data, offset, RGBA_PLAYER_OPAQUE);
      } else if (vision) {
        if (getFogCell(vision, width, col, row)) {
          writePixel(data, offset, RGBA_CLEAR);
        } else if (explored && getFogCell(explored, width, col, row)) {
          writePixel(data, offset, RGBA_PLAYER_EXPLORED);
        } else {
          writePixel(data, offset, RGBA_PLAYER_OPAQUE);
        }
      } else {
        writePixel(data, offset, RGBA_CLEAR);
      }
    }
  }
}

/** Preenche `data` (`width * height * 4`) com os 4 canais do shader `VisionLightingFilter` por célula. */
export function fillVisionMaskImageData(
  data: Uint8ClampedArray,
  map: GameMap,
  tokens: readonly Token[],
  viewer: FogViewer,
  options?: FogRenderOptions,
): void {
  const { width, height, fog } = map;
  const manual = decodeFogBits(fog.manual, width, height);
  const lightGrid = computeMapLightGrid(map, tokens, {
    ...(options?.bakedPropLights ? { bakedPropLights: options.bakedPropLights } : {}),
    ...(options?.heightfield !== undefined ? { heightfield: options.heightfield } : {}),
  });

  if (viewer.role === 'gm') {
    const previewToken =
      viewer.previewTokenId !== undefined && viewer.previewTokenId !== null
        ? tokens.find((t) => t.id === viewer.previewTokenId && t.mapId === map.id)
        : undefined;

    if (previewToken) {
      const vision = fog.autoEnabled
        ? computeTokenVisionGrid(map, previewToken, resolveRendererTokenProfile(previewToken, map, options), lightGrid, {
            manualFogBits: manual,
            ...(options?.heightfield !== undefined ? { heightfield: options.heightfield } : {}),
          })
        : null;
      const explored = buildExploredBitsForToken(previewToken, map, options?.characters);

      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          const idx = row * width + col;
          const offset = idx * 4;
          if (getFogCell(manual, width, col, row)) {
            writePixel(data, offset, MASK_GM_PREVIEW_MANUAL);
          } else if (vision) {
            const code = vision.perception[idx] ?? PERCEPTION_CODE_UNSEEN;
            const seen = explored !== null && getFogCell(explored, width, col, row);
            writePixel(data, offset, maskRgbaForPerceptionCode(code, seen, MASK_UNSEEN));
          } else {
            writePixel(data, offset, maskRgbaForUnfoggedLightCode(lightGrid.levels[idx] ?? LIGHT_CODE_BRIGHT));
          }
        }
      }
      return;
    }

    const anyVision = fog.autoEnabled ? computeAllPlayersGrid(map, tokens, lightGrid, manual, options) : null;
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const idx = row * width + col;
        const offset = idx * 4;
        if (getFogCell(manual, width, col, row)) {
          writePixel(data, offset, MASK_GM_MANUAL);
        } else {
          const lightCode = lightGrid.levels[idx] ?? LIGHT_CODE_BRIGHT;
          const base = maskRgbaForGmLightCode(lightCode);
          if (anyVision && !getFogCell(anyVision.seenBits, width, col, row)) {
            writePixel(data, offset, [
              Math.max(base[0], MASK_GM_AUTO_OUTSIDE[0]),
              Math.min(base[1], MASK_GM_AUTO_OUTSIDE[1]),
              Math.max(base[2], MASK_GM_AUTO_OUTSIDE[2]),
              Math.max(base[3], MASK_GM_AUTO_OUTSIDE[3]),
            ]);
          } else {
            writePixel(data, offset, base);
          }
        }
      }
    }
    return;
  }

  const vision = fog.autoEnabled
    ? computePlayerVisionGrid(
        map,
        tokens,
        (t) => resolveRendererTokenProfile(t as Token, map, options),
        (t) => isViewerObserverToken(t, viewer.playerId, options?.characters),
        {
          lightGrid,
          manualFogBits: manual,
          ...(options?.heightfield !== undefined ? { heightfield: options.heightfield } : {}),
        },
      )
    : null;
  const exploredBase64 = fog.autoEnabled && fog.rememberExplored ? fog.explored[viewer.playerId] : undefined;
  const explored = exploredBase64 !== undefined ? decodeFogBits(exploredBase64, width, height) : null;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const idx = row * width + col;
      const offset = idx * 4;
      if (getFogCell(manual, width, col, row)) {
        writePixel(data, offset, MASK_UNSEEN);
      } else if (vision) {
        const code = vision.perception[idx] ?? PERCEPTION_CODE_UNSEEN;
        const seen = explored !== null && getFogCell(explored, width, col, row);
        writePixel(data, offset, maskRgbaForPerceptionCode(code, seen, MASK_UNSEEN));
      } else {
        writePixel(data, offset, maskRgbaForUnfoggedLightCode(lightGrid.levels[idx] ?? LIGHT_CODE_BRIGHT));
      }
    }
  }
}

/** Converte coordenadas de mundo para a célula do grid sob o ponteiro, ou `null` se fora do mapa. */
export function worldToFogCell(world: Point, map: Pick<GameMap, 'width' | 'height'>): FogCell | null {
  const x = Math.floor(world.x / WORLD_UNITS_PER_CELL);
  const y = Math.floor(world.y / WORLD_UNITS_PER_CELL);
  if (x < 0 || x >= map.width || y < 0 || y >= map.height) return null;
  return { x, y };
}

/** Converte coordenadas de mundo para a célula mais próxima dentro do mapa (para arrasto de retângulo). */
export function clampFogCell(world: Point, map: Pick<GameMap, 'width' | 'height'>): FogCell {
  const x = Math.min(map.width - 1, Math.max(0, Math.floor(world.x / WORLD_UNITS_PER_CELL)));
  const y = Math.min(map.height - 1, Math.max(0, Math.floor(world.y / WORLD_UNITS_PER_CELL)));
  return { x, y };
}

function profileSig(p: VisionProfile | undefined): string {
  if (!p) return '';
  return `${p.normalRangeFeet ?? 'inf'}:${p.darkvisionFeet}:${p.magicalDarknessVisionFeet}:${p.blindsightFeet}:${p.tremorsenseFeet}:${p.truesightFeet}:${p.blinded ? '1' : '0'}`;
}

/** Assinatura do estado que afeta névoa, iluminação, oclusão e visão: só recalcula o canvas quando muda. */
export function fogSignature(
  map: GameMap | null,
  tokens: readonly Token[],
  viewer: FogViewer,
  options?: FogRenderOptions,
): string {
  if (!map) return '';
  const { fog } = map;
  const previewId = viewer.role === 'gm' ? (viewer.previewTokenId ?? '') : '';
  const previewToken = previewId ? tokens.find((t) => t.id === previewId && t.mapId === map.id) : undefined;
  const charOwner =
    previewToken && previewToken.characterId !== null
      ? options?.characters?.[previewToken.characterId]?.ownerId
      : undefined;
  const exploredPart =
    viewer.role === 'gm'
      ? previewToken
        ? [...new Set([...previewToken.ownerIds, ...(charOwner ? [charOwner] : []), ...(previewToken.ownerIds.length === 0 && !charOwner ? [previewToken.id] : [])])]
            .map((id) => `${id}:${fog.explored[id] ?? ''}`)
            .join(',')
        : ''
      : (fog.explored[viewer.playerId] ?? '');

  const wallSig = map.walls.map((w) => `${w.id}:${w.x1},${w.y1},${w.x2},${w.y2}:${w.kind}:${w.open ? '1' : '0'}:${w.layer}`).join(';');
  const lightSig = map.lights
    .map((l) => {
      const att = l.attach.kind === 'point' ? `p:${l.attach.x},${l.attach.y}` : `t:${l.attach.tokenId}`;
      return `${l.id}:${l.kind}:${l.enabled ? '1' : '0'}:${l.brightFeet}/${l.dimFeet}/${l.darknessFeet}:${l.spellLevel ?? ''}:${l.angleDeg}@${l.directionDeg}:${l.color}:${l.layer}:${att}`;
    })
    .join(';');
  const lightingSig = `${map.lighting.environment}:${map.lighting.timeOfDay}:${map.lighting.ambientOverride ?? ''}`;
  const overrideSig = Object.entries(map.propLightOverrides)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
  const bakedSig = options?.bakedPropLights
    ? `${options.bakedPropLights.length}:${options.bakedPropLights[0]?.id ?? ''}:${options.bakedPropLights[options.bakedPropLights.length - 1]?.id ?? ''}`
    : '';

  const carriedLightTokenIds = new Set(
    map.lights.flatMap((l) => (l.enabled && l.attach.kind === 'token' ? [l.attach.tokenId] : [])),
  );

  const parts = [
    map.id,
    `${map.width}x${map.height}`,
    viewer.role,
    viewer.playerId,
    previewId,
    fog.manual,
    fog.autoEnabled ? '1' : '0',
    String(fog.visionFeet),
    fog.rememberExplored ? '1' : '0',
    exploredPart,
    lightingSig,
    wallSig,
    lightSig,
    overrideSig,
    bakedSig,
  ];

  for (const t of tokens) {
    if (t.mapId !== map.id) continue;
    const isCarriedLight = carriedLightTokenIds.has(t.id);
    const isRelevantObserver =
      fog.autoEnabled &&
      (previewToken
        ? t.id === previewToken.id
        : viewer.role === 'gm'
          ? isPlayerOwnedToken(t, options?.characters)
          : isViewerObserverToken(t, viewer.playerId, options?.characters));
    if (!isCarriedLight && !isRelevantObserver) continue;
    const pSig = profileSig(options?.visionProfiles?.[t.id]);
    const condSig = t.conditions.active.map((c) => c.condition).join(',');
    parts.push(`${t.id}:${t.position.x},${t.position.y}:${t.size}:${t.visionFeet ?? ''}:${t.characterId ?? ''}:${condSig}:${pSig}`);
  }
  return parts.join('|');
}
