import type { Size } from 'rules-engine/schemas';
import type { LightLevel, PerceptionKind } from 'rules-engine/vision';
import type { MapLayer, TerrainHeightfield, WallSegment } from '../collision';
import type { ExtractedPropLight, MapLightSource, MapLightingConfig, PropLightOverrides } from '../lighting';
import type { Point } from '../protocol/common';
import type { MapFog } from '../protocol/fog';

/**
 * Tipos e códigos numéricos do solver compartilhado de iluminação e visão ocluída (nota 0081).
 * Módulo puro sem dependências de Node, Electron, React ou PixiJS.
 */

export const LIGHT_CODE_DARKNESS = 0;
export const LIGHT_CODE_DIM = 1;
export const LIGHT_CODE_BRIGHT = 2;
export const LIGHT_CODE_MAGICAL_DARKNESS = 3;

const CODE_TO_LIGHT: readonly LightLevel[] = ['darkness', 'dim', 'bright', 'magical_darkness'];

export function lightLevelFromCode(code: number): LightLevel {
  return CODE_TO_LIGHT[code] ?? 'darkness';
}

export function lightCodeFromLevel(level: LightLevel): number {
  switch (level) {
    case 'darkness':
      return LIGHT_CODE_DARKNESS;
    case 'dim':
      return LIGHT_CODE_DIM;
    case 'bright':
      return LIGHT_CODE_BRIGHT;
    case 'magical_darkness':
      return LIGHT_CODE_MAGICAL_DARKNESS;
  }
}

export const PERCEPTION_CODE_UNSEEN = 0;
export const PERCEPTION_CODE_SENSE_ONLY = 1;
export const PERCEPTION_CODE_DARKVISION_BW = 2;
export const PERCEPTION_CODE_DIM_COLOR = 3;
export const PERCEPTION_CODE_BRIGHT_COLOR = 4;

const CODE_TO_PERCEPTION: readonly PerceptionKind[] = ['unseen', 'sense_only', 'darkvision_bw', 'dim_color', 'bright_color'];

export function perceptionKindFromCode(code: number): PerceptionKind {
  return CODE_TO_PERCEPTION[code] ?? 'unseen';
}

export function perceptionCodeFromKind(kind: PerceptionKind): number {
  switch (kind) {
    case 'unseen':
      return PERCEPTION_CODE_UNSEEN;
    case 'sense_only':
      return PERCEPTION_CODE_SENSE_ONLY;
    case 'darkvision_bw':
      return PERCEPTION_CODE_DARKVISION_BW;
    case 'dim_color':
      return PERCEPTION_CODE_DIM_COLOR;
    case 'bright_color':
      return PERCEPTION_CODE_BRIGHT_COLOR;
  }
}

export interface ResolvedLightSource {
  readonly id: string;
  readonly kind: 'light' | 'darkness';
  readonly x: number;
  readonly y: number;
  readonly brightFeet: number;
  readonly dimFeet: number;
  readonly darknessFeet: number;
  readonly spellLevel: number | null;
  readonly angleDeg: number;
  readonly directionDeg: number;
  readonly color: string;
  readonly flicker: boolean;
  readonly layer: MapLayer;
  readonly elevationFeet: number;
  readonly source: 'runtime' | 'prop';
}

export interface MapLightGrid {
  readonly width: number;
  readonly height: number;
  readonly layer: MapLayer;
  readonly levels: Uint8Array;
  readonly sources: readonly ResolvedLightSource[];
}

export interface VisionGrid {
  readonly width: number;
  readonly height: number;
  readonly layer: MapLayer;
  readonly perception: Uint8Array;
  readonly seenBits: Uint8Array;
}

export interface LightingVisionMapLike {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly fog: MapFog;
  readonly walls: readonly WallSegment[];
  readonly lighting: MapLightingConfig;
  readonly lights: readonly MapLightSource[];
  readonly propLightOverrides: PropLightOverrides;
}

export interface LightingVisionTokenLike {
  readonly id: string;
  readonly mapId: string;
  readonly position: Point;
  readonly size: Size;
  readonly ownerIds: readonly string[];
  readonly characterId: string | null;
  readonly visionFeet: number | null;
}

export interface LightingVisionSceneOptions {
  readonly layer?: MapLayer;
  readonly heightfield?: TerrainHeightfield | null;
  readonly bakedPropLights?: readonly ExtractedPropLight[];
  readonly manualFogBits?: Uint8Array;
  readonly lightGrid?: MapLightGrid;
}
