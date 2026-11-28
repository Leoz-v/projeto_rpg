import type { GameMap, Token } from '../../../shared/protocol';
import { parseMapDocument, type VttMapDocument } from '../canvas3d/map/mapDocument';
import { getLiquidPreset } from '../canvas3d/terrain/liquidSurface';
import { DEFAULT_UNDERLAY_ID, getMaterial, VOID_OVERLAY_ID } from '../canvas3d/terrain/materials';
import type { MapViewerMode } from './MapView';

/**
 * Helpers de exibição e miniaturas rápidas para os cards de seleção de mapa.
 * A miniatura 3D é rasterizada em Canvas 2D diretamente do documento JSON do
 * terreno (sem abrir contexto WebGL por card) e cacheada por SHA-256.
 */

export type MapKind = '3d' | 'image2d' | 'grid2d';

export interface MapPreviewBitmap {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray;
}

export function mapKind(map: Pick<GameMap, 'background' | 'scene3d'>): MapKind {
  if (map.scene3d !== null) return '3d';
  if (map.background !== null) return 'image2d';
  return 'grid2d';
}

export function defaultViewerModeForMap(map: Pick<GameMap, 'scene3d'>): MapViewerMode {
  return map.scene3d !== null ? '3d' : '2d';
}

export function countTokensByMap(tokens: Readonly<Record<string, Pick<Token, 'mapId'>>>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const token of Object.values(tokens)) {
    counts[token.mapId] = (counts[token.mapId] ?? 0) + 1;
  }
  return counts;
}

export function formatMapMeta(map: Pick<GameMap, 'width' | 'height' | 'cellPx'>, tokenCount: number): string {
  const parts: string[] = [`${map.width}×${map.height}`];
  if (map.cellPx !== null) parts.push(`${map.cellPx} px`);
  if (tokenCount > 0) parts.push(`${tokenCount} ${tokenCount === 1 ? 'token' : 'tokens'}`);
  return parts.join(' · ');
}

function clampByte(value: number): number {
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

function hexChannels(hex: number): readonly [number, number, number] {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

function blendPixel(rgba: Uint8ClampedArray, offset: number, r: number, g: number, b: number, alpha: number): void {
  const inv = 1 - alpha;
  const curR = rgba[offset] ?? 0;
  const curG = rgba[offset + 1] ?? 0;
  const curB = rgba[offset + 2] ?? 0;
  rgba[offset] = clampByte(curR * inv + r * alpha);
  rgba[offset + 1] = clampByte(curG * inv + g * alpha);
  rgba[offset + 2] = clampByte(curB * inv + b * alpha);
  rgba[offset + 3] = 255;
}

const PREVIEW_MAX_DIM = 128;

/**
 * Gera os pixels RGBA de uma miniatura de topo (top-down) a partir do documento
 * de um mapa 3D: materiais do terreno, relevo sombreado, recortes/buracos,
 * líquidos de superfície e marcações discretas de props.
 */
export function compute3dPreviewPixels(doc: VttMapDocument): MapPreviewBitmap {
  const tilesW = Math.max(1, Math.round(doc.terrain.width));
  const tilesL = Math.max(1, Math.round(doc.terrain.length));
  const scale = Math.max(1, Math.min(4, Math.floor(PREVIEW_MAX_DIM / Math.max(tilesW, tilesL))));
  const width = tilesW * scale;
  const height = tilesL * scale;
  const rgba = new Uint8ClampedArray(width * height * 4);

  const { underlays, overlays, heights, holes, vertexShade } = doc.terrain;
  const interiorUnderlays = doc.interior?.underlays;
  const vStride = tilesW + 1;

  for (let tz = 0; tz < tilesL; tz++) {
    for (let tx = 0; tx < tilesW; tx++) {
      const idx = tz * tilesW + tx;
      const isHole = (holes?.[idx] ?? 0) !== 0;

      let r: number;
      let g: number;
      let b: number;

      if (isHole) {
        const interiorId = interiorUnderlays?.[idx];
        if (interiorId !== undefined && interiorId > 0) {
          const [ir, ig, ib] = hexChannels(getMaterial(interiorId).hex);
          r = ir * 0.45;
          g = ig * 0.45;
          b = ib * 0.45;
        } else {
          r = 18;
          g = 17;
          b = 24;
        }
      } else {
        const overlayId = overlays[idx] ?? 0;
        const underlayId = underlays[idx] ?? DEFAULT_UNDERLAY_ID;
        const mat = overlayId > 0 && overlayId !== VOID_OVERLAY_ID ? getMaterial(overlayId) : getMaterial(underlayId);
        const [mr, mg, mb] = hexChannels(mat.hex);

        const h00 = heights[tz * vStride + tx] ?? 0;
        const h10 = heights[tz * vStride + tx + 1] ?? h00;
        const h01 = heights[(tz + 1) * vStride + tx] ?? h00;
        const slope = ((h00 - h10) + (h00 - h01)) / 512;
        const hillShade = Math.max(0.65, Math.min(1.32, 1 + slope));
        const ao = 1 - ((vertexShade?.[tz * vStride + tx] ?? 0) / 255) * 0.45;
        const factor = hillShade * ao;

        r = mr * factor;
        g = mg * factor;
        b = mb * factor;
      }

      const cr = clampByte(r);
      const cg = clampByte(g);
      const cb = clampByte(b);

      for (let sy = 0; sy < scale; sy++) {
        const py = tz * scale + sy;
        for (let sx = 0; sx < scale; sx++) {
          const px = tx * scale + sx;
          const off = (py * width + px) * 4;
          rgba[off] = cr;
          rgba[off + 1] = cg;
          rgba[off + 2] = cb;
          rgba[off + 3] = 255;
        }
      }
    }
  }

  for (const liquid of doc.liquids ?? []) {
    if (liquid.layer !== 'surface') continue;
    const preset = getLiquidPreset(liquid.preset);
    const [lr, lg, lb] = hexChannels(liquid.colorHex ?? preset.hex);
    const alpha = Math.max(0.25, Math.min(0.95, liquid.opacity ?? preset.opacity));
    const minX = Math.max(0, Math.floor(liquid.x * scale));
    const maxX = Math.min(width, Math.ceil((liquid.x + liquid.width) * scale));
    const minY = Math.max(0, Math.floor(liquid.z * scale));
    const maxY = Math.min(height, Math.ceil((liquid.z + liquid.length) * scale));

    for (let py = minY; py < maxY; py++) {
      for (let px = minX; px < maxX; px++) {
        blendPixel(rgba, (py * width + px) * 4, lr, lg, lb, alpha);
      }
    }
  }

  const propRadius = scale >= 3 ? 1 : 0;
  for (const prop of doc.props) {
    if ((prop.layer ?? 'surface') !== 'surface') continue;
    const cx = Math.floor((prop.tileX + 0.5) * scale);
    const cz = Math.floor((prop.tileZ + 0.5) * scale);
    for (let dy = -propRadius; dy <= propRadius; dy++) {
      const py = cz + dy;
      if (py < 0 || py >= height) continue;
      for (let dx = -propRadius; dx <= propRadius; dx++) {
        const px = cx + dx;
        if (px < 0 || px >= width) continue;
        blendPixel(rgba, (py * width + px) * 4, 244, 224, 179, 0.72);
      }
    }
  }

  return { width, height, rgba };
}

const previewCache = new Map<string, Promise<string>>();

/** Carrega o JSON de um mapa 3D pelo SHA-256 e devolve uma imagem PNG (data URL) cacheada. */
export function render3dPreviewDataUrl(sceneHash: string, mapName: string): Promise<string> {
  const cached = previewCache.get(sceneHash);
  if (cached) return cached;

  const job = (async (): Promise<string> => {
    const response = await fetch(`vtt-asset://${sceneHash}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw: unknown = await response.json();
    const doc = parseMapDocument(raw, mapName);
    const bitmap = compute3dPreviewPixels(doc);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Contexto 2D indisponível');
    const imageData = ctx.createImageData(bitmap.width, bitmap.height);
    imageData.data.set(bitmap.rgba);
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  })().catch((err: unknown) => {
    previewCache.delete(sceneHash);
    throw err;
  });

  previewCache.set(sceneHash, job);
  return job;
}
