import { z } from 'zod';
import { MapLayerSchema, WallCoordSchema } from '../collision/types';
import { ConditionSpellSchema, InstanceIdSchema, NameSchema, UuidSchema } from '../protocol/common';

/**
 * Schemas e tipos de iluminação dinâmica, ambiente/horário e overrides de tochas do mapa.
 * Módulo puro sem dependências de Node, Electron, React ou PixiJS (nota 0081).
 */

export const MapEnvironmentSchema = z.enum(['exterior', 'interior']);
export type MapEnvironment = z.infer<typeof MapEnvironmentSchema>;

export const TimeOfDaySchema = z.enum(['day', 'dawn', 'dusk', 'twilight', 'night']);
export type TimeOfDay = z.infer<typeof TimeOfDaySchema>;

export const AmbientLightSchema = z.enum(['bright', 'dim', 'darkness']);
export type AmbientLight = z.infer<typeof AmbientLightSchema>;

export const MapLightingConfigSchema = z.strictObject({
  environment: MapEnvironmentSchema,
  timeOfDay: TimeOfDaySchema,
  ambientOverride: AmbientLightSchema.nullable().default(null),
});
export type MapLightingConfig = z.infer<typeof MapLightingConfigSchema>;

export function defaultMapLighting(environment: MapEnvironment = 'exterior', timeOfDay: TimeOfDay = 'day'): MapLightingConfig {
  return { environment, timeOfDay, ambientOverride: null };
}

export const LightAttachmentSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('point'), x: WallCoordSchema, y: WallCoordSchema }),
  z.strictObject({ kind: z.literal('token'), tokenId: UuidSchema }),
]);
export type LightAttachment = z.infer<typeof LightAttachmentSchema>;

export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const LightRadiusFeetSchema = z.int().min(0).max(300);

export const MapLightSourceSchema = z.strictObject({
  id: UuidSchema,
  name: NameSchema,
  kind: z.enum(['light', 'darkness']),
  enabled: z.boolean().default(true),
  brightFeet: LightRadiusFeetSchema,
  dimFeet: LightRadiusFeetSchema,
  darknessFeet: LightRadiusFeetSchema.default(0),
  spellLevel: z.int().min(0).max(9).nullable().default(null),
  angleDeg: z.number().min(5).max(360).default(360),
  directionDeg: z.number().min(-360).max(360).default(0),
  color: HexColorSchema.default('#ff9442'),
  flicker: z.boolean().default(false),
  layer: MapLayerSchema.default('surface'),
  elevationFeet: z.number().min(-20).max(100).default(5),
  attach: LightAttachmentSchema,
  ownerId: UuidSchema.nullable().default(null),
  spell: ConditionSpellSchema.optional(),
  itemInstanceId: InstanceIdSchema.optional(),
});
export type MapLightSource = z.infer<typeof MapLightSourceSchema>;

export const NewMapLightSourceSchema = z.strictObject({
  name: NameSchema,
  kind: z.enum(['light', 'darkness']),
  enabled: z.boolean().optional(),
  brightFeet: LightRadiusFeetSchema.optional(),
  dimFeet: LightRadiusFeetSchema.optional(),
  darknessFeet: LightRadiusFeetSchema.optional(),
  spellLevel: z.int().min(0).max(9).nullable().optional(),
  angleDeg: z.number().min(5).max(360).optional(),
  directionDeg: z.number().min(-360).max(360).optional(),
  color: HexColorSchema.optional(),
  flicker: z.boolean().optional(),
  layer: MapLayerSchema.optional(),
  elevationFeet: z.number().min(-20).max(100).optional(),
  attach: LightAttachmentSchema,
  spell: ConditionSpellSchema.optional(),
  itemInstanceId: InstanceIdSchema.optional(),
});
export type NewMapLightSource = z.infer<typeof NewMapLightSourceSchema>;

export const PropLightOverrideSchema = z.enum(['off', 'removed']);
export type PropLightOverride = z.infer<typeof PropLightOverrideSchema>;

export const PropLightIdSchema = z.string().min(1).max(120);
export const PropLightOverridesSchema = z.record(PropLightIdSchema, PropLightOverrideSchema);
export type PropLightOverrides = z.infer<typeof PropLightOverridesSchema>;
