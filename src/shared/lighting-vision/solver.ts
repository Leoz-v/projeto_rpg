import { FEET_PER_SQUARE, spaceSquares } from 'rules-engine/space';
import {
  ambientLightLevel,
  classifyPerception,
  type IlluminationContribution,
  isPerceived,
  maxVisionRangeFeet,
  type PerceptionKind,
  resolveEffectiveLight,
  type VisionProfile,
} from 'rules-engine/vision';
import {
  hasTerrainLineOfSight3D,
  isSurfaceHole,
  type MapLayer,
  type Point2D,
  pointToSegmentDistance,
  segmentIntersectsSegment,
  type TerrainHeightfield,
  wallBlocksLight,
  wallBlocksVision,
  type WallSegment,
} from '../collision';
import type { ExtractedPropLight } from '../lighting';
import { WORLD_UNITS_PER_CELL } from '../protocol/constants';
import { decodeFogBits, emptyFogBits, getFogCell, setFogCell } from '../protocol/fog';
import {
  type LightingVisionMapLike,
  type LightingVisionSceneOptions,
  type LightingVisionTokenLike,
  lightCodeFromLevel,
  lightLevelFromCode,
  type MapLightGrid,
  PERCEPTION_CODE_UNSEEN,
  perceptionCodeFromKind,
  perceptionKindFromCode,
  type ResolvedLightSource,
  type VisionGrid,
} from './types';

/**
 * Solver compartilhado de iluminação ocluída e visão guiada por ficha/sentidos (nota 0081).
 * Módulo puro usado no Host (autoridade/filtragem) e nos renderizadores 2D/3D.
 */

interface IndexedWall {
  readonly wall: WallSegment;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

function indexWalls(walls: readonly WallSegment[], layer: MapLayer, mode: 'vision' | 'light'): IndexedWall[] {
  const out: IndexedWall[] = [];
  for (const wall of walls) {
    if (wall.layer !== layer) continue;
    const blocks = mode === 'light' ? wallBlocksLight(wall) : wallBlocksVision(wall);
    if (!blocks) continue;
    out.push({
      wall,
      minX: Math.min(wall.x1, wall.x2),
      maxX: Math.max(wall.x1, wall.x2),
      minY: Math.min(wall.y1, wall.y2),
      maxY: Math.max(wall.y1, wall.y2),
    });
  }
  return out;
}

function hasLineOfSight2DFast(from: Point2D, to: Point2D, indexedWalls: readonly IndexedWall[]): boolean {
  if (indexedWalls.length === 0) return true;
  if (Math.hypot(to.x - from.x, to.y - from.y) < 1e-5) return true;

  const rMinX = Math.min(from.x, to.x) - 1e-4;
  const rMaxX = Math.max(from.x, to.x) + 1e-4;
  const rMinY = Math.min(from.y, to.y) - 1e-4;
  const rMaxY = Math.max(from.y, to.y) + 1e-4;

  const terrainHits: number[] = [];
  for (const entry of indexedWalls) {
    if (entry.maxX < rMinX || entry.minX > rMaxX || entry.maxY < rMinY || entry.minY > rMaxY) continue;
    const w = entry.wall;
    const hit = segmentIntersectsSegment(from, to, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 });
    if (!hit || hit.t <= 1e-4 || hit.t >= 1 - 1e-4) continue;
    if (w.kind !== 'terrain_wall') return false;
    if (!terrainHits.some((prev) => Math.abs(prev - hit.t) < 1e-3)) {
      terrainHits.push(hit.t);
      if (terrainHits.length >= 2) return false;
    }
  }
  return true;
}

function isWithinCone(originX: number, originY: number, px: number, py: number, angleDeg: number, directionDeg: number): boolean {
  if (angleDeg >= 359.9) return true;
  const dx = px - originX;
  const dy = py - originY;
  if (Math.hypot(dx, dy) < 1e-4) return true;
  const targetRad = Math.atan2(dy, dx);
  const dirRad = (directionDeg * Math.PI) / 180;
  let diff = targetRad - dirRad;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const halfConeRad = (angleDeg * 0.5 * Math.PI) / 180;
  return Math.abs(diff) <= halfConeRad + 1e-5;
}

function tokenCenterCells(token: Pick<LightingVisionTokenLike, 'position' | 'size'>): Point2D {
  const side = spaceSquares(token.size);
  return {
    x: token.position.x / WORLD_UNITS_PER_CELL + side * 0.5,
    y: token.position.y / WORLD_UNITS_PER_CELL + side * 0.5,
  };
}

function hasOccludedLineOfSight(
  from: { x: number; y: number; elevationFeet: number; layer: MapLayer },
  to: { x: number; y: number; elevationFeet: number; layer: MapLayer },
  wallsByLayer: { surface: readonly IndexedWall[]; interior: readonly IndexedWall[] },
  heightfield: TerrainHeightfield | null,
): boolean {
  if (from.layer !== to.layer) {
    if (!heightfield) return false;
    if (!hasTerrainLineOfSight3D(heightfield, from, to)) return false;
    return (
      hasLineOfSight2DFast(from, to, wallsByLayer[from.layer]) &&
      hasLineOfSight2DFast(from, to, wallsByLayer[to.layer])
    );
  }
  if (!hasLineOfSight2DFast(from, to, wallsByLayer[from.layer])) return false;
  if (heightfield && !hasTerrainLineOfSight3D(heightfield, from, to)) return false;
  return true;
}

/** Resolve todas as fontes de luz ativas (dinâmicas + props 3D não apagados/removidos) em coordenadas de células. */
export function resolveActiveLightSources(
  map: Pick<LightingVisionMapLike, 'id' | 'lights' | 'propLightOverrides'>,
  tokens: readonly LightingVisionTokenLike[],
  bakedPropLights?: readonly ExtractedPropLight[],
): ResolvedLightSource[] {
  const tokenMap = new Map<string, LightingVisionTokenLike>();
  for (const t of tokens) {
    if (t.mapId === map.id) tokenMap.set(t.id, t);
  }

  const out: ResolvedLightSource[] = [];
  for (const light of map.lights) {
    if (!light.enabled) continue;
    let x: number;
    let y: number;
    if (light.attach.kind === 'point') {
      x = light.attach.x;
      y = light.attach.y;
    } else {
      const holder = tokenMap.get(light.attach.tokenId);
      if (!holder) continue;
      const center = tokenCenterCells(holder);
      x = center.x;
      y = center.y;
    }
    out.push({
      id: light.id,
      kind: light.kind,
      x,
      y,
      brightFeet: light.brightFeet,
      dimFeet: light.dimFeet,
      darknessFeet: light.darknessFeet,
      spellLevel: light.spellLevel,
      angleDeg: light.angleDeg,
      directionDeg: light.directionDeg,
      color: light.color,
      flicker: light.flicker,
      layer: light.layer,
      elevationFeet: light.elevationFeet,
      source: 'runtime',
    });
  }

  if (bakedPropLights) {
    for (const prop of bakedPropLights) {
      const override = map.propLightOverrides[prop.id];
      if (override === 'off' || override === 'removed') continue;
      out.push({
        id: prop.id,
        kind: 'light',
        x: prop.x,
        y: prop.y,
        brightFeet: prop.brightFeet,
        dimFeet: prop.dimFeet,
        darknessFeet: 0,
        spellLevel: null,
        angleDeg: 360,
        directionDeg: 0,
        color: prop.color,
        flicker: prop.flicker,
        layer: prop.layer,
        elevationFeet: prop.elevationFeet,
        source: 'prop',
      });
    }
  }

  return out;
}

/** Luz ambiente base na coordenada `(x, y)` da camada especificada, considerando aberturas do subsolo para o céu. */
export function ambientAtPoint(
  map: Pick<LightingVisionMapLike, 'lighting'>,
  x: number,
  y: number,
  layer: MapLayer,
  heightfield?: TerrainHeightfield | null,
): 'bright' | 'dim' | 'darkness' {
  if (map.lighting.ambientOverride !== null) return map.lighting.ambientOverride;
  if (layer === 'interior') {
    if (heightfield && isSurfaceHole(heightfield, x, y)) {
      return ambientLightLevel(map.lighting.environment, map.lighting.timeOfDay);
    }
    return 'darkness';
  }
  return ambientLightLevel(map.lighting.environment, map.lighting.timeOfDay);
}

/** Calcula o nível efetivo de luz de cada célula do mapa para `layer` com oclusão por paredes e terreno. */
export function computeMapLightGrid(
  map: LightingVisionMapLike,
  tokens: readonly LightingVisionTokenLike[],
  options?: Pick<LightingVisionSceneOptions, 'layer' | 'heightfield' | 'bakedPropLights'>,
): MapLightGrid {
  const layer: MapLayer = options?.layer ?? 'surface';
  const heightfield = options?.heightfield ?? null;
  const sources = resolveActiveLightSources(map, tokens, options?.bakedPropLights);
  const cellCount = map.width * map.height;
  const levels = new Uint8Array(cellCount);

  for (let row = 0; row < map.height; row++) {
    const cy = row + 0.5;
    for (let col = 0; col < map.width; col++) {
      levels[row * map.width + col] = lightCodeFromLevel(ambientAtPoint(map, col + 0.5, cy, layer, heightfield));
    }
  }

  if (sources.length === 0) {
    return { width: map.width, height: map.height, layer, levels, sources };
  }

  const surfaceWalls = indexWalls(map.walls, 'surface', 'light');
  const interiorWalls = indexWalls(map.walls, 'interior', 'light');
  const touched = new Map<number, IlluminationContribution[]>();

  for (const src of sources) {
    if (src.layer !== layer && !heightfield) continue;
    const maxRadiusFeet = src.kind === 'darkness' ? src.darknessFeet : src.brightFeet + src.dimFeet;
    if (maxRadiusFeet <= 0) continue;
    const maxRadiusCells = maxRadiusFeet / FEET_PER_SQUARE;
    const brightRadiusCells = src.brightFeet / FEET_PER_SQUARE;

    const filterNear = (list: readonly IndexedWall[]): IndexedWall[] =>
      list.filter((entry) => pointToSegmentDistance(src, entry.wall) <= maxRadiusCells + 0.5);

    const localWallsByLayer = {
      surface: filterNear(surfaceWalls),
      interior: filterNear(interiorWalls),
    };

    const minCol = Math.max(0, Math.floor(src.x - maxRadiusCells));
    const maxCol = Math.min(map.width - 1, Math.ceil(src.x + maxRadiusCells));
    const minRow = Math.max(0, Math.floor(src.y - maxRadiusCells));
    const maxRow = Math.min(map.height - 1, Math.ceil(src.y + maxRadiusCells));
    const from3d = { x: src.x, y: src.y, elevationFeet: src.elevationFeet, layer: src.layer };

    for (let row = minRow; row <= maxRow; row++) {
      const cy = row + 0.5;
      const dy = cy - src.y;
      if (Math.abs(dy) > maxRadiusCells + 1e-6) continue;
      for (let col = minCol; col <= maxCol; col++) {
        const cx = col + 0.5;
        const distCells = Math.hypot(cx - src.x, dy);
        if (distCells > maxRadiusCells + 1e-6) continue;
        if (!isWithinCone(src.x, src.y, cx, cy, src.angleDeg, src.directionDeg)) continue;
        if (!hasOccludedLineOfSight(from3d, { x: cx, y: cy, elevationFeet: 2.5, layer }, localWallsByLayer, heightfield)) {
          continue;
        }
        const idx = row * map.width + col;
        let list = touched.get(idx);
        if (!list) {
          list = [];
          touched.set(idx, list);
        }
        if (src.kind === 'darkness') {
          list.push({ kind: 'darkness', spellLevel: src.spellLevel ?? 2 });
        } else {
          list.push({
            kind: 'light',
            level: distCells <= brightRadiusCells + 1e-6 ? 'bright' : 'dim',
            spellLevel: src.spellLevel,
          });
        }
      }
    }
  }

  for (const [idx, contribs] of touched) {
    const col = idx % map.width;
    const row = Math.floor(idx / map.width);
    const ambient = ambientAtPoint(map, col + 0.5, row + 0.5, layer, heightfield);
    levels[idx] = lightCodeFromLevel(resolveEffectiveLight(ambient, contribs));
  }

  return { width: map.width, height: map.height, layer, levels, sources };
}

/** Calcula a grade de percepção por célula de um token observador considerando paredes, terreno, luz e ficha. */
export function computeTokenVisionGrid(
  map: LightingVisionMapLike,
  token: LightingVisionTokenLike,
  profile: VisionProfile,
  lightGrid: MapLightGrid,
  options?: Pick<LightingVisionSceneOptions, 'layer' | 'heightfield' | 'manualFogBits'>,
): VisionGrid {
  const layer: MapLayer = options?.layer ?? lightGrid.layer;
  const heightfield = options?.heightfield ?? null;
  const manual = options?.manualFogBits ?? decodeFogBits(map.fog.manual, map.width, map.height);
  const perception = new Uint8Array(map.width * map.height);
  const seenBits = emptyFogBits(map.width, map.height);

  if (profile.blinded && profile.blindsightFeet <= 0) {
    return { width: map.width, height: map.height, layer, perception, seenBits };
  }

  const side = spaceSquares(token.size);
  const x0 = token.position.x / WORLD_UNITS_PER_CELL;
  const y0 = token.position.y / WORLD_UNITS_PER_CELL;
  const x1 = x0 + side;
  const y1 = y0 + side;
  const ox = x0 + side * 0.5;
  const oy = y0 + side * 0.5;

  let minCol = 0;
  let maxCol = map.width - 1;
  let minRow = 0;
  let maxRow = map.height - 1;
  if (profile.normalRangeFeet !== null) {
    const maxRadiusCells = maxVisionRangeFeet(profile, 0) / FEET_PER_SQUARE;
    if (maxRadiusCells <= 0) {
      return { width: map.width, height: map.height, layer, perception, seenBits };
    }
    minCol = Math.max(0, Math.floor(x0 - maxRadiusCells));
    maxCol = Math.min(map.width - 1, Math.floor(x1 + maxRadiusCells));
    minRow = Math.max(0, Math.floor(y0 - maxRadiusCells));
    maxRow = Math.min(map.height - 1, Math.floor(y1 + maxRadiusCells));
  }

  const wallsByLayer = {
    surface: indexWalls(map.walls, 'surface', 'vision'),
    interior: indexWalls(map.walls, 'interior', 'vision'),
  };
  const from3d = { x: ox, y: oy, elevationFeet: 5, layer };

  for (let row = minRow; row <= maxRow; row++) {
    const cy = row + 0.5;
    const dy = cy < y0 ? y0 - cy : cy > y1 ? cy - y1 : 0;
    for (let col = minCol; col <= maxCol; col++) {
      if (getFogCell(manual, map.width, col, row)) continue;
      const cx = col + 0.5;
      const dx = cx < x0 ? x0 - cx : cx > x1 ? cx - x1 : 0;
      const distanceFeet = Math.hypot(dx, dy) * FEET_PER_SQUARE;
      const idx = row * map.width + col;
      const light = lightLevelFromCode(lightGrid.levels[idx] ?? 0);

      // `targetGrounded: false` evita que Tremorsense revele células de piso atrás de paredes sólidas.
      const optimistic = classifyPerception(profile, {
        distanceFeet,
        light,
        hasLineOfSight: true,
        targetGrounded: false,
      });
      if (!isPerceived(optimistic)) continue;

      if (!hasOccludedLineOfSight(from3d, { x: cx, y: cy, elevationFeet: 2.5, layer }, wallsByLayer, heightfield)) {
        continue;
      }

      perception[idx] = perceptionCodeFromKind(optimistic);
      setFogCell(seenBits, map.width, col, row, true);
    }
  }

  return { width: map.width, height: map.height, layer, perception, seenBits };
}

/** Mescla múltiplas grades de percepção ficando com a melhor percepção por célula. */
export function mergeVisionGrids(width: number, height: number, layer: MapLayer, grids: readonly VisionGrid[]): VisionGrid {
  const perception = new Uint8Array(width * height);
  const seenBits = emptyFogBits(width, height);
  for (const g of grids) {
    for (let i = 0; i < perception.length; i++) {
      const code = g.perception[i] ?? 0;
      if (code > (perception[i] ?? 0)) perception[i] = code;
    }
    for (let i = 0; i < seenBits.length; i++) {
      seenBits[i] = (seenBits[i] ?? 0) | (g.seenBits[i] ?? 0);
    }
  }
  return { width, height, layer, perception, seenBits };
}

/** Classifica como `observerToken` (com `observerProfile`) percebe `targetToken` em qualquer uma das células ocupadas pelo alvo. */
export function classifyTokenPerceptionByObserver(
  map: LightingVisionMapLike,
  observerToken: LightingVisionTokenLike,
  observerProfile: VisionProfile,
  targetToken: LightingVisionTokenLike,
  lightGrid: MapLightGrid,
  options?: Pick<LightingVisionSceneOptions, 'layer' | 'heightfield' | 'manualFogBits'> & {
    wallsByLayer?: { surface: readonly IndexedWall[]; interior: readonly IndexedWall[] };
  },
): PerceptionKind {
  const layer: MapLayer = options?.layer ?? lightGrid.layer;
  const heightfield = options?.heightfield ?? null;
  const manual = options?.manualFogBits ?? decodeFogBits(map.fog.manual, map.width, map.height);
  const wallsByLayer = options?.wallsByLayer ?? {
    surface: indexWalls(map.walls, 'surface', 'vision'),
    interior: indexWalls(map.walls, 'interior', 'vision'),
  };

  const obsSide = spaceSquares(observerToken.size);
  const ox0 = observerToken.position.x / WORLD_UNITS_PER_CELL;
  const oy0 = observerToken.position.y / WORLD_UNITS_PER_CELL;
  const ox1 = ox0 + obsSide;
  const oy1 = oy0 + obsSide;
  const from3d = { x: ox0 + obsSide * 0.5, y: oy0 + obsSide * 0.5, elevationFeet: 5, layer };

  const tgtSide = spaceSquares(targetToken.size);
  const tx0 = targetToken.position.x / WORLD_UNITS_PER_CELL;
  const ty0 = targetToken.position.y / WORLD_UNITS_PER_CELL;
  const minCol = Math.max(0, Math.floor(tx0));
  const maxCol = Math.min(map.width - 1, Math.ceil(tx0 + tgtSide) - 1);
  const minRow = Math.max(0, Math.floor(ty0));
  const maxRow = Math.min(map.height - 1, Math.ceil(ty0 + tgtSide) - 1);

  let bestCode = PERCEPTION_CODE_UNSEEN;
  for (let row = minRow; row <= maxRow; row++) {
    const cy = row + 0.5;
    const dy = cy < oy0 ? oy0 - cy : cy > oy1 ? cy - oy1 : 0;
    for (let col = minCol; col <= maxCol; col++) {
      if (getFogCell(manual, map.width, col, row)) continue;
      const cx = col + 0.5;
      const dx = cx < ox0 ? ox0 - cx : cx > ox1 ? cx - ox1 : 0;
      const distanceFeet = Math.hypot(dx, dy) * FEET_PER_SQUARE;
      const light = lightLevelFromCode(lightGrid.levels[row * map.width + col] ?? 0);
      const los = hasOccludedLineOfSight(from3d, { x: cx, y: cy, elevationFeet: 2.5, layer }, wallsByLayer, heightfield);
      const kind = classifyPerception(observerProfile, {
        distanceFeet,
        light,
        hasLineOfSight: los,
        targetGrounded: true,
      });
      const code = perceptionCodeFromKind(kind);
      if (code > bestCode) bestCode = code;
    }
  }
  return perceptionKindFromCode(bestCode);
}

/** Calcula a grade combinada de visão atual de um conjunto de tokens observadores (ex.: tokens de um jogador). */
export function computePlayerVisionGrid(
  map: LightingVisionMapLike,
  tokens: readonly LightingVisionTokenLike[],
  getProfile: (token: LightingVisionTokenLike) => VisionProfile,
  isObserver: (token: LightingVisionTokenLike) => boolean,
  options?: LightingVisionSceneOptions,
): VisionGrid {
  const layer: MapLayer = options?.layer ?? 'surface';
  const heightfield = options?.heightfield ?? null;
  const manual = options?.manualFogBits ?? decodeFogBits(map.fog.manual, map.width, map.height);
  const lightGrid =
    options?.lightGrid ??
    computeMapLightGrid(map, tokens, {
      layer,
      heightfield,
      ...(options?.bakedPropLights ? { bakedPropLights: options.bakedPropLights } : {}),
    });

  const grids: VisionGrid[] = [];
  for (const token of tokens) {
    if (token.mapId !== map.id || !isObserver(token)) continue;
    grids.push(
      computeTokenVisionGrid(map, token, getProfile(token), lightGrid, {
        layer,
        heightfield,
        manualFogBits: manual,
      }),
    );
  }
  if (grids.length === 0) {
    return {
      width: map.width,
      height: map.height,
      layer,
      perception: new Uint8Array(map.width * map.height),
      seenBits: emptyFogBits(map.width, map.height),
    };
  }
  return mergeVisionGrids(map.width, map.height, layer, grids);
}

/** Decide se `targetToken` é percebido por algum token controlado pelo jogador segundo D&D (luz, oclusão e sentidos). */
export function isTokenPerceivedByPlayer(
  map: LightingVisionMapLike | undefined,
  tokens: readonly LightingVisionTokenLike[],
  targetToken: LightingVisionTokenLike,
  getProfile: (token: LightingVisionTokenLike) => VisionProfile,
  isObserver: (token: LightingVisionTokenLike) => boolean,
  options?: LightingVisionSceneOptions,
): boolean {
  if (isObserver(targetToken)) return true;
  if (!map || targetToken.mapId !== map.id) return true;

  const manual = options?.manualFogBits ?? decodeFogBits(map.fog.manual, map.width, map.height);
  const tgtSide = spaceSquares(targetToken.size);
  const tx0 = targetToken.position.x / WORLD_UNITS_PER_CELL;
  const ty0 = targetToken.position.y / WORLD_UNITS_PER_CELL;
  const minCol = Math.max(0, Math.floor(tx0));
  const maxCol = Math.min(map.width - 1, Math.ceil(tx0 + tgtSide) - 1);
  const minRow = Math.max(0, Math.floor(ty0));
  const maxRow = Math.min(map.height - 1, Math.ceil(ty0 + tgtSide) - 1);

  if (!map.fog.autoEnabled) {
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        if (!getFogCell(manual, map.width, col, row)) return true;
      }
    }
    return false;
  }

  const layer: MapLayer = options?.layer ?? 'surface';
  const heightfield = options?.heightfield ?? null;
  const lightGrid =
    options?.lightGrid ??
    computeMapLightGrid(map, tokens, {
      layer,
      heightfield,
      ...(options?.bakedPropLights ? { bakedPropLights: options.bakedPropLights } : {}),
    });
  const wallsByLayer = {
    surface: indexWalls(map.walls, 'surface', 'vision'),
    interior: indexWalls(map.walls, 'interior', 'vision'),
  };

  for (const observer of tokens) {
    if (observer.mapId !== map.id || !isObserver(observer)) continue;
    const kind = classifyTokenPerceptionByObserver(map, observer, getProfile(observer), targetToken, lightGrid, {
      layer,
      heightfield,
      manualFogBits: manual,
      wallsByLayer,
    });
    if (isPerceived(kind)) return true;
  }
  return false;
}
