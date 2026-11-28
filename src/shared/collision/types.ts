import { z } from 'zod';
import { UuidSchema } from '../protocol/common';
import { MAX_MAP_CELLS } from '../protocol/constants';

/**
 * Schemas e tipos de colisão e oclusão (paredes, portas, janelas e terreno).
 * Módulo puro sem dependências de Node, Electron, React ou PixiJS (nota 0061).
 */

export const MapLayerSchema = z.enum(['surface', 'interior']);
export type MapLayer = z.infer<typeof MapLayerSchema>;

export const WallKindSchema = z.enum(['wall', 'door', 'window', 'terrain_wall']);
export type WallKind = z.infer<typeof WallKindSchema>;

export const WallSourceSchema = z.enum(['manual', 'baked_3d']);
export type WallSource = z.infer<typeof WallSourceSchema>;

export const WallCoordSchema = z.number().min(0).max(MAX_MAP_CELLS);

export const WallSegmentSchema = z.strictObject({
  id: UuidSchema,
  x1: WallCoordSchema,
  y1: WallCoordSchema,
  x2: WallCoordSchema,
  y2: WallCoordSchema,
  kind: WallKindSchema,
  open: z.boolean().default(false),
  locked: z.boolean().default(false),
  layer: MapLayerSchema.default('surface'),
  heightFeet: z.number().min(0).max(200).optional(),
  source: WallSourceSchema.default('manual'),
});
export type WallSegment = z.infer<typeof WallSegmentSchema>;

export const NewWallSegmentSchema = z.strictObject({
  x1: WallCoordSchema,
  y1: WallCoordSchema,
  x2: WallCoordSchema,
  y2: WallCoordSchema,
  kind: WallKindSchema,
  open: z.boolean().optional(),
  locked: z.boolean().optional(),
  layer: MapLayerSchema.optional(),
  heightFeet: z.number().min(0).max(200).optional(),
  source: WallSourceSchema.optional(),
});
export type NewWallSegment = z.infer<typeof NewWallSegmentSchema>;

export function wallBlocksVision(w: Pick<WallSegment, 'kind' | 'open'>): boolean {
  return w.kind === 'wall' || w.kind === 'terrain_wall' || (w.kind === 'door' && !w.open);
}

export function wallBlocksLight(w: Pick<WallSegment, 'kind' | 'open'>): boolean {
  return w.kind === 'wall' || w.kind === 'terrain_wall' || (w.kind === 'door' && !w.open);
}

export function wallBlocksMovement(w: Pick<WallSegment, 'kind' | 'open'>): boolean {
  return w.kind === 'wall' || w.kind === 'window' || (w.kind === 'door' && !w.open);
}
