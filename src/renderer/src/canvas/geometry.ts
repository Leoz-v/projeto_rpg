import { spaceSquares } from 'rules-engine/space';
import type { Size } from 'rules-engine/schemas';
import { type GameMap, type Point, WORLD_UNITS_PER_CELL } from '../../../shared/protocol';

/**
 * Geometria do mapa, sem PixiJS: câmera (mundo ↔ tela), zoom, encaixe no grid
 * e limites. Coordenadas do mundo em unidades lógicas (1 célula = 5 ft = 100),
 * nunca em pixels de tela (CLAUDE.md).
 */

/** `x`/`y`: onde a origem do mundo aparece na tela (px); `zoom`: px por unidade. */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export function screenToWorld(camera: Camera, screen: Point): Point {
  return { x: (screen.x - camera.x) / camera.zoom, y: (screen.y - camera.y) / camera.zoom };
}

export function worldToScreen(camera: Camera, world: Point): Point {
  return { x: world.x * camera.zoom + camera.x, y: world.y * camera.zoom + camera.y };
}

/** Zoom por `factor` mantendo fixo o ponto do mundo sob `screen` (o cursor). */
export function zoomAt(camera: Camera, screen: Point, factor: number): Camera {
  const zoom = clamp(camera.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  const anchor = screenToWorld(camera, screen);
  return { zoom, x: screen.x - anchor.x * zoom, y: screen.y - anchor.y * zoom };
}

/** Enquadra o mapa inteiro, centralizado, com uma margem. */
export function fitMap(map: Pick<GameMap, 'width' | 'height'>, viewport: Viewport, margin = 24): Camera {
  const worldW = map.width * WORLD_UNITS_PER_CELL;
  const worldH = map.height * WORLD_UNITS_PER_CELL;
  const zoom = clamp(Math.min((viewport.width - margin * 2) / worldW, (viewport.height - margin * 2) / worldH), MIN_ZOOM, MAX_ZOOM);
  return { zoom, x: (viewport.width - worldW * zoom) / 2, y: (viewport.height - worldH * zoom) / 2 };
}

/** Lado do token em unidades do mundo (o espaço do tamanho, regra do motor). */
export function tokenSide(size: Size): number {
  return spaceSquares(size) * WORLD_UNITS_PER_CELL;
}

/**
 * Posição final de um token solto em `corner` (canto superior esquerdo):
 * encaixa no grid (Tiny em meias células) e mantém o token inteiro no mapa.
 */
export function placeToken(corner: Point, size: Size, map: Pick<GameMap, 'width' | 'height'>): Point {
  const side = tokenSide(size);
  const step = Math.min(side, WORLD_UNITS_PER_CELL);
  const snap = (v: number, max: number): number => clamp(Math.round(v / step) * step, 0, max - side);
  return { x: snap(corner.x, map.width * WORLD_UNITS_PER_CELL), y: snap(corner.y, map.height * WORLD_UNITS_PER_CELL) };
}
