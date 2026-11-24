import { FEET_PER_SQUARE, spaceSquares } from 'rules-engine/space';
import type { Size } from 'rules-engine/schemas';
import { z } from 'zod';
import { DEFAULT_VISION_FEET, MAX_MAP_CELLS, MAX_VISION_FEET, MIN_VISION_FEET, WORLD_UNITS_PER_CELL } from './constants';
import { type Point, UuidSchema } from './common';

/**
 * Névoa de guerra (nota 0056): bitsets por célula do grid (1 célula = 5 ft = 100 unidades),
 * cálculo de visão automática por alcance e regra de visibilidade de tokens.
 * Módulo puro sem dependências de Node, Electron ou PixiJS (usado no Host e no renderer).
 */

export const VisionFeetSchema = z.int().min(MIN_VISION_FEET).max(MAX_VISION_FEET);

export const FogCellSchema = z.strictObject({
  x: z.int().min(0).max(MAX_MAP_CELLS - 1),
  y: z.int().min(0).max(MAX_MAP_CELLS - 1),
});
export type FogCell = z.infer<typeof FogCellSchema>;

export const FogModeSchema = z.enum(['cover', 'reveal']);
export type FogMode = z.infer<typeof FogModeSchema>;

export const MapFogSchema = z.strictObject({
  /** Células cobertas pela névoa manual (definida pelo mestre; só o mestre revela). Bitset em base64 (1 = coberta). */
  manual: z.base64(),
  /** Se a névoa automática (visão dos tokens do jogador) está ativa neste mapa. */
  autoEnabled: z.boolean(),
  /** Alcance de visão padrão em pés dos tokens neste mapa (5–300). */
  visionFeet: VisionFeetSchema,
  /** Se os jogadores lembram das células já vistas fora do campo de visão atual. */
  rememberExplored: z.boolean(),
  /** Células já vistas por jogador (playerId → bitset em base64, 1 = já vista). */
  explored: z.record(UuidSchema, z.base64()),
});
export type MapFog = z.infer<typeof MapFogSchema>;

export interface FogMapLike {
  id: string;
  width: number;
  height: number;
  fog: MapFog;
}

export interface FogTokenLike {
  mapId: string;
  position: Point;
  size: Size;
  ownerIds: readonly string[];
  visionFeet: number | null;
}

/** Número de bytes necessários para armazenar um bit por célula de um mapa `width × height`. */
export function fogByteLength(width: number, height: number): number {
  return Math.ceil((width * height) / 8);
}

/** Zera bits excedentes no último byte além de `width * height`. */
function maskTrailingBits(bytes: Uint8Array, width: number, height: number): void {
  const total = width * height;
  const rem = total % 8;
  if (rem !== 0 && bytes.length > 0) {
    const last = bytes.length - 1;
    bytes[last] = (bytes[last] ?? 0) & ((1 << rem) - 1);
  }
}

export function emptyFogBits(width: number, height: number): Uint8Array {
  return new Uint8Array(fogByteLength(width, height));
}

export function fullFogBits(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(fogByteLength(width, height));
  bytes.fill(0xff);
  maskTrailingBits(bytes, width, height);
  return bytes;
}

export function encodeFogBits(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeFogBits(base64: string, width: number, height: number): Uint8Array {
  const expected = fogByteLength(width, height);
  const bytes = new Uint8Array(expected);
  if (base64.length === 0) return bytes;
  const binary = atob(base64);
  const len = Math.min(expected, binary.length);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  maskTrailingBits(bytes, width, height);
  return bytes;
}

export function defaultMapFog(width: number, height: number): MapFog {
  return {
    manual: encodeFogBits(emptyFogBits(width, height)),
    autoEnabled: false,
    visionFeet: DEFAULT_VISION_FEET,
    rememberExplored: true,
    explored: {},
  };
}

export function getFogCell(bits: Uint8Array, width: number, col: number, row: number): boolean {
  const index = row * width + col;
  const byte = bits[index >> 3];
  return byte !== undefined && ((byte >> (index & 7)) & 1) === 1;
}

export function setFogCell(bits: Uint8Array, width: number, col: number, row: number, covered: boolean): void {
  const index = row * width + col;
  const byteIndex = index >> 3;
  const current = bits[byteIndex];
  if (current === undefined) return;
  const mask = 1 << (index & 7);
  bits[byteIndex] = covered ? current | mask : current & ~mask;
}

export function applyFogCells(bits: Uint8Array, width: number, height: number, cells: readonly FogCell[], covered: boolean): Uint8Array {
  const next = new Uint8Array(bits);
  for (const cell of cells) {
    if (cell.x >= 0 && cell.x < width && cell.y >= 0 && cell.y < height) {
      setFogCell(next, width, cell.x, cell.y, covered);
    }
  }
  return next;
}

export function applyFogRect(bits: Uint8Array, width: number, height: number, from: FogCell, to: FogCell, covered: boolean): Uint8Array {
  const next = new Uint8Array(bits);
  const minX = Math.max(0, Math.min(from.x, to.x));
  const maxX = Math.min(width - 1, Math.max(from.x, to.x));
  const minY = Math.max(0, Math.min(from.y, to.y));
  const maxY = Math.min(height - 1, Math.max(from.y, to.y));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      setFogCell(next, width, x, y, covered);
    }
  }
  return next;
}

export function unionFogBits(a: Uint8Array, b: Uint8Array): Uint8Array {
  const len = Math.max(a.length, b.length);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = (a[i] ?? 0) | (b[i] ?? 0);
  return out;
}

export function fogBitsEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function hasAnyFogBit(bits: Uint8Array): boolean {
  for (const byte of bits) if (byte !== 0) return true;
  return false;
}

/** Células do grid que um token enxerga, usando distância euclidiana do espaço do token ao centro da célula. */
export function computeTokenVision(
  map: Pick<FogMapLike, 'width' | 'height'>,
  token: Pick<FogTokenLike, 'position' | 'size' | 'visionFeet'>,
  defaultVisionFeet: number,
): Uint8Array {
  const bits = emptyFogBits(map.width, map.height);
  const visionFeet = token.visionFeet ?? defaultVisionFeet;
  const radius = visionFeet / FEET_PER_SQUARE;
  const radiusSq = radius * radius;
  const side = spaceSquares(token.size);
  const x0 = token.position.x / WORLD_UNITS_PER_CELL;
  const y0 = token.position.y / WORLD_UNITS_PER_CELL;
  const x1 = x0 + side;
  const y1 = y0 + side;

  const minCol = Math.max(0, Math.floor(x0 - radius));
  const maxCol = Math.min(map.width - 1, Math.floor(x1 + radius));
  const minRow = Math.max(0, Math.floor(y0 - radius));
  const maxRow = Math.min(map.height - 1, Math.floor(y1 + radius));

  for (let row = minRow; row <= maxRow; row++) {
    const cy = row + 0.5;
    const dy = cy < y0 ? y0 - cy : cy > y1 ? cy - y1 : 0;
    const dySq = dy * dy;
    if (dySq > radiusSq) continue;
    for (let col = minCol; col <= maxCol; col++) {
      const cx = col + 0.5;
      const dx = cx < x0 ? x0 - cx : cx > x1 ? cx - x1 : 0;
      if (dx * dx + dySq <= radiusSq) setFogCell(bits, map.width, col, row, true);
    }
  }
  return bits;
}

/** Células atualmente visíveis para `playerId` no mapa (união dos seus tokens, descontada a névoa manual). */
export function computePlayerVision(map: FogMapLike, tokens: readonly FogTokenLike[], playerId: string): Uint8Array {
  const manual = decodeFogBits(map.fog.manual, map.width, map.height);
  const vision = emptyFogBits(map.width, map.height);
  for (const token of tokens) {
    if (token.mapId !== map.id || !token.ownerIds.includes(playerId)) continue;
    const tv = computeTokenVision(map, token, map.fog.visionFeet);
    for (let i = 0; i < vision.length; i++) vision[i] = (vision[i] ?? 0) | (tv[i] ?? 0);
  }
  for (let i = 0; i < vision.length; i++) vision[i] = (vision[i] ?? 0) & ~(manual[i] ?? 0);
  return vision;
}

/** Células atualmente visíveis por qualquer jogador com token no mapa (para pré-visualização leve do mestre). */
export function computeAllPlayersVision(map: FogMapLike, tokens: readonly FogTokenLike[]): Uint8Array {
  const manual = decodeFogBits(map.fog.manual, map.width, map.height);
  const vision = emptyFogBits(map.width, map.height);
  for (const token of tokens) {
    if (token.mapId !== map.id || token.ownerIds.length === 0) continue;
    const tv = computeTokenVision(map, token, map.fog.visionFeet);
    for (let i = 0; i < vision.length; i++) vision[i] = (vision[i] ?? 0) | (tv[i] ?? 0);
  }
  for (let i = 0; i < vision.length; i++) vision[i] = (vision[i] ?? 0) & ~(manual[i] ?? 0);
  return vision;
}

/**
 * Se `token` está visível para `playerId`:
 * - o dono do token sempre o vê;
 * - tokens alheios precisam ter ao menos uma célula ocupada fora da névoa manual
 *   e, com névoa automática ativa, dentro da visão atual de algum token do jogador.
 */
export function isTokenVisibleToPlayer(
  map: FogMapLike | undefined,
  tokens: readonly FogTokenLike[],
  token: FogTokenLike,
  playerId: string,
  precomputedVision?: Uint8Array,
): boolean {
  if (token.ownerIds.includes(playerId)) return true;
  if (!map || token.mapId !== map.id) return true;
  const side = spaceSquares(token.size);
  const x0 = token.position.x / WORLD_UNITS_PER_CELL;
  const y0 = token.position.y / WORLD_UNITS_PER_CELL;
  const minCol = Math.max(0, Math.floor(x0));
  const maxCol = Math.min(map.width - 1, Math.ceil(x0 + side) - 1);
  const minRow = Math.max(0, Math.floor(y0));
  const maxRow = Math.min(map.height - 1, Math.ceil(y0 + side) - 1);

  if (map.fog.autoEnabled) {
    const vision = precomputedVision ?? computePlayerVision(map, tokens, playerId);
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        if (getFogCell(vision, map.width, col, row)) return true;
      }
    }
    return false;
  }

  const manual = decodeFogBits(map.fog.manual, map.width, map.height);
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      if (!getFogCell(manual, map.width, col, row)) return true;
    }
  }
  return false;
}
