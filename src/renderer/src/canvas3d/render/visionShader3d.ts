import type { BaseMaterial3D, ShaderBit } from '@pixi/3d';
import type { Texture } from 'pixi.js';
import type { GameMap, MapLayer, MapLightingConfig, Token } from '../../../../shared/protocol';
import {
  computeMapLightGrid,
  computePlayerVisionGrid,
  computeTokenVisionGrid,
  decodeFogBits,
  emptyFogBits,
  getFogCell,
  LIGHT_CODE_BRIGHT,
  LIGHT_CODE_DARKNESS,
  LIGHT_CODE_DIM,
  LIGHT_CODE_MAGICAL_DARKNESS,
  mergeVisionGrids,
  PERCEPTION_CODE_BRIGHT_COLOR,
  PERCEPTION_CODE_DARKVISION_BW,
  PERCEPTION_CODE_DIM_COLOR,
  PERCEPTION_CODE_SENSE_ONLY,
  PERCEPTION_CODE_UNSEEN,
  unionFogBits,
  type VisionGrid,
} from '../../../../shared/protocol';
import {
  type FogRenderOptions,
  type FogViewer,
  isPlayerOwnedToken,
  isViewerObserverToken,
  resolveRendererTokenProfile,
  writePixel,
} from '../../canvas/fog-render';
import type { LightingPresetId } from './lightingSystem';

/**
 * ShaderBit `@pixi/3d` e gerador de máscara de visão/iluminação ocluída em 3D (nota 0061):
 * - Impede vazamento de `PointLight` sem sombras através de paredes e da laje entre superfície e subsolo;
 * - Aplica Darkvision seletiva em preto e branco apenas onde não há luz;
 * - Mantém áreas iluminadas em cores vivas e oculta regiões não vistas.
 */

export const visionLighting3dBit: ShaderBit = {
  name: 'vttVisionLighting3d',
  textures: ['visionMask'],
  bindings: {
    material: {
      /** `(mapWidthMeters, mapLengthMeters, enabled [0|1], isGmOverview [0|1])`. */
      uVisionBounds: 'vec4<f32>',
    },
  },
  gl: {
    fragment: {
      end: /* glsl */ `
{
  vec2 visionExtent = max(material.uVisionBounds.xy, vec2(0.001));
  vec2 visionUv = clamp(vPosition.xz / visionExtent, 0.0, 1.0);
  vec4 visionSample = sampleVisionMask(visionUv);
  if (material.uVisionBounds.z > 0.5) {
    float desat = visionSample.r;
    float vis = visionSample.g;
    float lightFactor = visionSample.b;

    float lightScale = mix(0.28, 1.0, lightFactor);
    vec3 litColor = finalColor * lightScale;
    float luma = dot(litColor, vec3(0.2126, 0.7152, 0.0722));
    float dvLuma = pow(clamp(luma * 2.1, 0.0, 1.0), 0.85);
    vec3 bwColor = desat > 0.85 ? vec3(0.92, 0.96, 1.04) * dvLuma : vec3(luma);
    vec3 graded = mix(litColor, bwColor, desat) * vis;
    finalColor = vis < 0.02 ? vec3(0.008, 0.007, 0.014) : graded;
  }
}`,
    },
  },
  gpu: {
    fragment: {
      end: /* wgsl */ `
{
  let visionExtent = max(material.uVisionBounds.xy, vec2<f32>(0.001));
  let visionUv = clamp(input.vPosition.xz / visionExtent, vec2<f32>(0.0), vec2<f32>(1.0));
  let visionSample = sampleVisionMask(visionUv);
  if (material.uVisionBounds.z > 0.5) {
    let desat = visionSample.r;
    let vis = visionSample.g;
    let lightFactor = visionSample.b;

    let lightScale = mix(0.28, 1.0, lightFactor);
    let litColor = finalColor * lightScale;
    let luma = dot(litColor, vec3<f32>(0.2126, 0.7152, 0.0722));
    let dvLuma = pow(clamp(luma * 2.1, 0.0, 1.0), 0.85);
    let bwColor = select(vec3<f32>(luma), vec3<f32>(0.92, 0.96, 1.04) * dvLuma, desat > 0.85);
    let graded = mix(litColor, bwColor, desat) * vis;
    finalColor = select(graded, vec3<f32>(0.008, 0.007, 0.014), vis < 0.02);
  }
}`,
    },
  },
};

export function applyVisionMaskToMaterial(
  mat: BaseMaterial3D,
  texture: Texture,
  worldWidthMeters: number,
  worldLengthMeters: number,
  enabled: boolean,
  isGmOverview: boolean,
): void {
  const texRecord = mat.textures as unknown as Record<string, Texture | undefined>;
  if ('visionMask' in texRecord) {
    texRecord['visionMask'] = texture;
  }
  const dataRecord = mat.data as unknown as Record<string, unknown>;
  if ('uVisionBounds' in dataRecord) {
    dataRecord['uVisionBounds'] = [worldWidthMeters, worldLengthMeters, enabled ? 1 : 0, isGmOverview ? 1 : 0];
    mat.update();
  }
}

export function mapLightingConfigToPreset(config: MapLightingConfig): Exclude<LightingPresetId, 'custom'> {
  if (config.ambientOverride === 'bright') return 'daylight';
  if (config.ambientOverride === 'dim') return 'twilight';
  if (config.ambientOverride === 'darkness') return config.environment === 'interior' ? 'dungeon' : 'night';
  if (config.environment === 'interior') return 'dungeon';
  switch (config.timeOfDay) {
    case 'day':
      return 'daylight';
    case 'dawn':
    case 'dusk':
      return 'golden_hour';
    case 'twilight':
      return 'twilight';
    case 'night':
      return 'night';
  }
}

function occludedLightByte(lightCode: number): number {
  switch (lightCode) {
    case LIGHT_CODE_BRIGHT:
      return 255;
    case LIGHT_CODE_DIM:
      return 150;
    case LIGHT_CODE_MAGICAL_DARKNESS:
    case LIGHT_CODE_DARKNESS:
    default:
      return 0;
  }
}

function buildExploredBitsForToken3d(token: Token, map: GameMap, options?: FogRenderOptions): Uint8Array | null {
  if (!map.fog.autoEnabled || !map.fog.rememberExplored) return null;
  const keys = new Set<string>(token.ownerIds);
  const charOwner =
    token.characterId !== null ? options?.characters?.[token.characterId]?.ownerId : undefined;
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

function computeAllPlayersGrid3d(
  map: GameMap,
  tokens: readonly Token[],
  layer: MapLayer,
  lightGrid: ReturnType<typeof computeMapLightGrid>,
  manualFogBits: Uint8Array,
  options?: FogRenderOptions,
): VisionGrid {
  const grids: VisionGrid[] = [];
  for (const t of tokens) {
    if (t.mapId !== map.id || !isPlayerOwnedToken(t, options?.characters)) continue;
    grids.push(
      computeTokenVisionGrid(map, t, resolveRendererTokenProfile(t, map, options), lightGrid, {
        layer,
        manualFogBits,
        ...(options?.heightfield !== undefined ? { heightfield: options.heightfield } : {}),
      }),
    );
  }
  return mergeVisionGrids(map.width, map.height, layer, grids);
}

/**
 * Preenche `data` (`width * height * 4`) para a textura `visionMask` do `ShaderBit` 3D:
 * `(R = dessaturação, G = visibilidade, B = luzOcluída, A = 255)`.
 * Mantém `A = 255` sempre para evitar perda por alpha pré-multiplicado no WebGL/WebGPU.
 */
export function fillVision3dMaskImageData(
  data: Uint8ClampedArray,
  map: GameMap,
  tokens: readonly Token[],
  viewer: FogViewer,
  options?: FogRenderOptions & { readonly layer?: MapLayer },
): void {
  const layer: MapLayer = options?.layer ?? 'surface';
  const { width, height, fog } = map;
  const manual = decodeFogBits(fog.manual, width, height);
  const lightGrid = computeMapLightGrid(map, tokens, {
    layer,
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
            layer,
            manualFogBits: manual,
            ...(options?.heightfield !== undefined ? { heightfield: options.heightfield } : {}),
          })
        : null;
      const explored = buildExploredBitsForToken3d(previewToken, map, options);

      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          const idx = row * width + col;
          const offset = idx * 4;
          if (getFogCell(manual, width, col, row)) {
            writePixel(data, offset, [0, 0, 0, 255]);
            continue;
          }
          const lightByte = occludedLightByte(lightGrid.levels[idx] ?? LIGHT_CODE_DARKNESS);
          if (vision) {
            const pCode = vision.perception[idx] ?? PERCEPTION_CODE_UNSEEN;
            const seen = explored !== null && getFogCell(explored, width, col, row);
            writePixel(data, offset, pixelForPerception(pCode, lightByte, seen));
          } else {
            writePixel(data, offset, pixelForUnfoggedLight(lightGrid.levels[idx] ?? LIGHT_CODE_DARKNESS));
          }
        }
      }
      return;
    }

    const anyVision = fog.autoEnabled ? computeAllPlayersGrid3d(map, tokens, layer, lightGrid, manual, options) : null;
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const idx = row * width + col;
        const offset = idx * 4;
        const lightByte = occludedLightByte(lightGrid.levels[idx] ?? LIGHT_CODE_DARKNESS);
        if (getFogCell(manual, width, col, row)) {
          writePixel(data, offset, [90, 110, lightByte, 255]);
        } else if (anyVision && !getFogCell(anyVision.seenBits, width, col, row)) {
          writePixel(data, offset, [40, 165, lightByte, 255]);
        } else {
          writePixel(data, offset, [0, 255, lightByte, 255]);
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
          layer,
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
        writePixel(data, offset, [0, 0, 0, 255]);
        continue;
      }
      const lightByte = occludedLightByte(lightGrid.levels[idx] ?? LIGHT_CODE_DARKNESS);
      if (vision) {
        const pCode = vision.perception[idx] ?? PERCEPTION_CODE_UNSEEN;
        const seen = explored !== null && getFogCell(explored, width, col, row);
        writePixel(data, offset, pixelForPerception(pCode, lightByte, seen));
      } else {
        writePixel(data, offset, pixelForUnfoggedLight(lightGrid.levels[idx] ?? LIGHT_CODE_DARKNESS));
      }
    }
  }
}

function pixelForPerception(
  pCode: number,
  lightByte: number,
  explored: boolean,
): readonly [number, number, number, number] {
  switch (pCode) {
    case PERCEPTION_CODE_BRIGHT_COLOR:
      return [0, 255, Math.max(lightByte, 255), 255];
    case PERCEPTION_CODE_DIM_COLOR:
      return [0, 175, Math.max(lightByte, 155), 255];
    case PERCEPTION_CODE_DARKVISION_BW:
      return [255, 215, 0, 255];
    case PERCEPTION_CODE_SENSE_ONLY:
      return [220, 140, 0, 255];
    case PERCEPTION_CODE_UNSEEN:
    default:
      return explored ? [175, 78, 0, 255] : [0, 0, 0, 255];
  }
}

function pixelForUnfoggedLight(lightCode: number): readonly [number, number, number, number] {
  switch (lightCode) {
    case LIGHT_CODE_BRIGHT:
      return [0, 255, 255, 255];
    case LIGHT_CODE_DIM:
      return [0, 185, 150, 255];
    case LIGHT_CODE_DARKNESS:
      return [0, 140, 0, 255];
    case LIGHT_CODE_MAGICAL_DARKNESS:
    default:
      return [0, 0, 0, 255];
  }
}
