import { spaceSquares } from 'rules-engine/space';
import type { Size } from 'rules-engine/schemas';
import { type GameMap, type Point, type Token, WORLD_UNITS_PER_CELL } from '../../../../shared/protocol';
import { placeToken, tokenSide } from '../../canvas/geometry';
import { METERS_PER_HEIGHT_UNIT, TILE_SIZE_METERS } from '../terrain/constants';
import type { Ray3 } from '../terrain/raycast';
import type { TerrainGrid } from '../terrain/terrainGrid';
import type { CameraViewMode } from './sceneManager';

/**
 * Conversões puras entre coordenadas lógicas 2D da mesa (`1 célula = 100 unidades`)
 * e coordenadas métricas 3D (`1 célula = 1,5 m`), mais raycast de seleção de tokens.
 */

export interface TokenFootprint3d {
  /** Centro do token no espaço 3D (metros). */
  centerX: number;
  centerZ: number;
  /** Altura do terreno sob o centro do token (metros). */
  groundY: number;
  /** Lado do espaço ocupado pelo token (metros; ex.: Medium = 1,5 m, Large = 3,0 m). */
  sideMeters: number;
  /** Coordenadas em tiles (contínuas). */
  tileX: number;
  tileZ: number;
}

export function tokenTo3dFootprint(token: Pick<Token, 'position' | 'size'>, grid: TerrainGrid): TokenFootprint3d {
  const sideUnits = tokenSide(token.size);
  const tileX = (token.position.x + sideUnits / 2) / WORLD_UNITS_PER_CELL;
  const tileZ = (token.position.y + sideUnits / 2) / WORLD_UNITS_PER_CELL;
  const centerX = tileX * TILE_SIZE_METERS;
  const centerZ = tileZ * TILE_SIZE_METERS;
  const groundY = grid.sampleHeightAtTileCoord(tileX, tileZ) * METERS_PER_HEIGHT_UNIT;
  const sideMeters = spaceSquares(token.size) * TILE_SIZE_METERS;
  return { centerX, centerZ, groundY, sideMeters, tileX, tileZ };
}

/**
 * Converte um ponto 3D no terreno (metros) na posição lógica 2D (canto superior
 * esquerdo) encaixada no grid e limitada ao mapa — idêntico ao 2D.
 */
export function world3dToTokenCorner(
  worldX: number,
  worldZ: number,
  size: Size,
  map: Pick<GameMap, 'width' | 'height'>,
): Point {
  const sideUnits = tokenSide(size);
  const centerUnitsX = (worldX / TILE_SIZE_METERS) * WORLD_UNITS_PER_CELL;
  const centerUnitsY = (worldZ / TILE_SIZE_METERS) * WORLD_UNITS_PER_CELL;
  return placeToken({ x: centerUnitsX - sideUnits / 2, y: centerUnitsY - sideUnits / 2 }, size, map);
}

/** Converte o alvo da câmera 3D (metros) no centro lógico 2D usado pelo painel do mestre. */
export function cameraTargetToWorld2d(targetX: number, targetZ: number): Point {
  return {
    x: (targetX / TILE_SIZE_METERS) * WORLD_UNITS_PER_CELL,
    y: (targetZ / TILE_SIZE_METERS) * WORLD_UNITS_PER_CELL,
  };
}

/**
 * Move um token em 1 passo de grid (meia célula para Miúdo, 1 célula para os demais)
 * na direção de tela (`forward`: +1 frente / -1 trás, `strafe`: +1 direita / -1 esquerda)
 * alinhada ao azimute atual da câmera 3D.
 */
export function stepTokenByCameraDirection(
  token: Pick<Token, 'position' | 'size'>,
  map: Pick<GameMap, 'width' | 'height'>,
  azimuthAngle: number,
  forward: -1 | 0 | 1,
  strafe: -1 | 0 | 1,
): Point {
  // Vetor "para frente" na tela no plano XZ é (-sin(az), -cos(az)), "para direita" é (cos(az), -sin(az)).
  const rawX = -Math.sin(azimuthAngle) * forward + Math.cos(azimuthAngle) * strafe;
  const rawZ = -Math.cos(azimuthAngle) * forward - Math.sin(azimuthAngle) * strafe;
  let stepX = 0;
  let stepZ = 0;
  if (Math.abs(rawX) >= Math.abs(rawZ)) {
    stepX = rawX >= 0 ? 1 : -1;
  } else {
    stepZ = rawZ >= 0 ? 1 : -1;
  }
  const stepUnits = Math.min(tokenSide(token.size), WORLD_UNITS_PER_CELL);
  return placeToken(
    { x: token.position.x + stepX * stepUnits, y: token.position.y + stepZ * stepUnits },
    token.size,
    map,
  );
}

function intersectRayAabb(
  ray: Ray3,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): number | null {
  let tMin = 0;
  let tMax = Infinity;
  const axes: readonly [number, number, number, number][] = [
    [ray.originX, ray.dirX, minX, maxX],
    [ray.originY, ray.dirY, minY, maxY],
    [ray.originZ, ray.dirZ, minZ, maxZ],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-8) {
      if (o < lo || o > hi) return null;
      continue;
    }
    const inv = 1 / d;
    let t1 = (lo - o) * inv;
    let t2 = (hi - o) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  return tMin >= 0 ? tMin : null;
}

function intersectRayDisc(ray: Ray3, cx: number, cy: number, cz: number, radius: number): number | null {
  if (Math.abs(ray.dirY) < 1e-7) return null;
  const t = (cy - ray.originY) / ray.dirY;
  if (t < 0) return null;
  const hx = ray.originX + ray.dirX * t;
  const hz = ray.originZ + ray.dirZ * t;
  const dx = hx - cx;
  const dz = hz - cz;
  return dx * dx + dz * dz <= radius * radius ? t : null;
}

/**
 * Seleciona o token mais próximo atingido pelo raio do cursor.
 * - Em `top_down`: testa o disco plano no chão (mesma área clicável do 2D).
 * - Em `perspective`/`orthographic`: testa tanto o standee vertical (billboard) quanto a base no chão.
 */
export function pickToken3d(
  ray: Ray3,
  tokens: readonly Token[],
  grid: TerrainGrid,
  viewMode: CameraViewMode,
): Token | null {
  let best: Token | null = null;
  let bestT = Infinity;

  for (const token of tokens) {
    const fp = tokenTo3dFootprint(token, grid);
    const radius = fp.sideMeters * 0.48;
    let hitT = intersectRayDisc(ray, fp.centerX, fp.groundY + 0.04, fp.centerZ, radius);

    if (viewMode !== 'top_down') {
      const halfW = fp.sideMeters * 0.46;
      const height = fp.sideMeters * 1.15;
      const boxT = intersectRayAabb(
        ray,
        fp.centerX - halfW,
        fp.groundY + 0.02,
        fp.centerZ - halfW,
        fp.centerX + halfW,
        fp.groundY + 0.04 + height,
        fp.centerZ + halfW,
      );
      if (boxT !== null && (hitT === null || boxT < hitT)) {
        hitT = boxT;
      }
    }

    if (hitT !== null && hitT < bestT) {
      bestT = hitT;
      best = token;
    }
  }

  return best;
}
