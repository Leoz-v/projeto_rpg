import { classifyPerception, maxVisionRangeFeet, type VisionProfile } from 'rules-engine/vision';
import {
  ambientAtPoint,
  computeVisibilityPolygon,
  decodeFogBits,
  emptyFogBits,
  getFogCell,
  LIGHT_CODE_BRIGHT,
  LIGHT_CODE_DARKNESS,
  LIGHT_CODE_DIM,
  LIGHT_CODE_MAGICAL_DARKNESS,
  lightLevelFromCode,
  perceptionCodeFromKind,
  PERCEPTION_CODE_UNSEEN,
  type Point2D,
  resolveActiveLightSources,
  type ResolvedLightSource,
  unionFogBits,
  WORLD_UNITS_PER_CELL,
  type GameMap,
  type Token,
} from '../../../shared/protocol';
import {
  type FogRenderOptions,
  type FogViewer,
  isPlayerOwnedToken,
  isViewerObserverToken,
  MASK_DARKNESS_UNLIT,
  MASK_GM_AUTO_OUTSIDE,
  MASK_GM_PREVIEW_MANUAL,
  MASK_GM_MANUAL,
  MASK_UNSEEN,
  maskRgbaForGmLightCode,
  maskRgbaForPerceptionCode,
  maskRgbaForUnfoggedLightCode,
  resolveRendererTokenProfile,
  writePixel,
} from './fog-render';
import { tokenSide } from './geometry';
import { spaceSquares } from 'rules-engine/space';

/**
 * Compositor 2D suave por polígonos de visibilidade/iluminação (nota 0061):
 * gera em paralelo a máscara de percepção do filtro `VisionLightingFilter` e o mapa
 * de cores de luz ocluídas por paredes/portas, sem vazar luz nem visão através de obstáculos.
 */

export interface Smooth2dComposeResult {
  readonly selfUnseenTokenIds: ReadonlySet<string>;
}

const MAX_CANVAS_PX = 440;

function pxScaleForMap(width: number, height: number): number {
  const maxDim = Math.max(1, width, height);
  return Math.max(4, Math.min(12, Math.floor(MAX_CANVAS_PX / maxDim)));
}

function tracePoly(ctx: CanvasRenderingContext2D, poly: readonly Point2D[], scale: number): void {
  const first = poly[0];
  if (!first) return;
  ctx.beginPath();
  ctx.moveTo(first.x * scale, first.y * scale);
  for (let i = 1; i < poly.length; i++) {
    const pt = poly[i];
    if (pt) ctx.lineTo(pt.x * scale, pt.y * scale);
  }
  ctx.closePath();
}

function lightSortKey(src: ResolvedLightSource): number {
  if (src.kind === 'light' && src.spellLevel === null) return 0;
  const level = src.spellLevel ?? 0;
  return (level + 1) * 10 + (src.kind === 'darkness' ? 2 : 1);
}

function paintLightGradient(
  ctx: CanvasRenderingContext2D,
  src: ResolvedLightSource,
  scale: number,
  pxW: number,
  pxH: number,
  poly: readonly Point2D[],
): void {
  const maxFeet = src.brightFeet + src.dimFeet;
  if (maxFeet <= 0 || poly.length < 3) return;
  const cx = src.x * scale;
  const cy = src.y * scale;
  const radiusPx = Math.max(1, (maxFeet / 5) * scale);
  const brightStop = Math.max(0, Math.min(1, src.brightFeet / maxFeet));

  ctx.save();
  tracePoly(ctx, poly, scale);
  ctx.clip();

  // Pintura aditiva suave das cores das fontes de luz embutidas ou carregadas.
  ctx.globalCompositeOperation = 'screen';
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radiusPx);
  grad.addColorStop(0, `${src.color}42`);
  grad.addColorStop(brightStop, `${src.color}33`);
  grad.addColorStop(Math.min(1, brightStop + (1 - brightStop) * 0.6), `${src.color}18`);
  grad.addColorStop(1, `${src.color}00`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, pxW, pxH);
  ctx.restore();
}

function fillLightLevelBuffer(
  lightLevels: Uint8Array,
  pxW: number,
  pxH: number,
  scale: number,
  map: GameMap,
  sources: readonly ResolvedLightSource[],
  tintCtx: CanvasRenderingContext2D,
): void {
  const scratch = document.createElement('canvas');
  scratch.width = pxW;
  scratch.height = pxH;
  const sCtx = scratch.getContext('2d');
  if (!sCtx) return;

  // Inicializa luz ambiente por pixel de subcélula.
  for (let py = 0; py < pxH; py++) {
    const cy = (py + 0.5) / scale;
    for (let px = 0; px < pxW; px++) {
      const cx = (px + 0.5) / scale;
      const amb = ambientAtPoint(map, cx, cy, 'surface', null);
      lightLevels[py * pxW + px] =
        amb === 'bright' ? LIGHT_CODE_BRIGHT : amb === 'dim' ? LIGHT_CODE_DIM : LIGHT_CODE_DARKNESS;
    }
  }

  const sorted = [...sources]
    .filter((s) => s.layer === 'surface')
    .sort((a, b) => lightSortKey(a) - lightSortKey(b));

  const bounds = { width: map.width, height: map.height };

  for (const src of sorted) {
    const maxFeet = src.kind === 'darkness' ? src.darknessFeet : src.brightFeet + src.dimFeet;
    if (maxFeet <= 0) continue;
    const maxRadiusCells = maxFeet / 5;
    const poly = computeVisibilityPolygon({ x: src.x, y: src.y }, maxRadiusCells, map.walls, {
      layer: 'surface',
      mode: 'light',
      bounds,
      angleDeg: src.angleDeg,
      directionDeg: src.directionDeg,
      circleSegments: 64,
    });
    if (poly.length < 3) continue;

    sCtx.clearRect(0, 0, pxW, pxH);
    sCtx.fillStyle = '#ffffff';
    tracePoly(sCtx, poly, scale);
    sCtx.fill();

    const mask = sCtx.getImageData(0, 0, pxW, pxH).data;
    const minPxX = Math.max(0, Math.floor((src.x - maxRadiusCells) * scale));
    const maxPxX = Math.min(pxW - 1, Math.ceil((src.x + maxRadiusCells) * scale));
    const minPxY = Math.max(0, Math.floor((src.y - maxRadiusCells) * scale));
    const maxPxY = Math.min(pxH - 1, Math.ceil((src.y + maxRadiusCells) * scale));

    if (src.kind === 'darkness') {
      const darkRadiusCellsSq = maxRadiusCells * maxRadiusCells + 1e-4;
      for (let py = minPxY; py <= maxPxY; py++) {
        const cy = (py + 0.5) / scale - src.y;
        for (let px = minPxX; px <= maxPxX; px++) {
          if ((mask[(py * pxW + px) * 4 + 3] ?? 0) < 128) continue;
          const cx = (px + 0.5) / scale - src.x;
          if (cx * cx + cy * cy <= darkRadiusCellsSq) {
            lightLevels[py * pxW + px] = LIGHT_CODE_MAGICAL_DARKNESS;
          }
        }
      }
      // Recorta cores de fontes suprimidas dentro da zona de escuridão mágica.
      tintCtx.save();
      tracePoly(tintCtx, poly, scale);
      tintCtx.clip();
      tintCtx.globalCompositeOperation = 'destination-out';
      tintCtx.fillStyle = '#000000';
      tintCtx.fillRect(minPxX, minPxY, maxPxX - minPxX + 1, maxPxY - minPxY + 1);
      tintCtx.restore();
    } else {
      const brightCells = src.brightFeet / 5;
      const brightSq = brightCells * brightCells + 1e-4;
      const totalSq = maxRadiusCells * maxRadiusCells + 1e-4;
      const isHigherMagic = (src.spellLevel ?? -1) > 0;

      for (let py = minPxY; py <= maxPxY; py++) {
        const cy = (py + 0.5) / scale - src.y;
        for (let px = minPxX; px <= maxPxX; px++) {
          if ((mask[(py * pxW + px) * 4 + 3] ?? 0) < 128) continue;
          const cx = (px + 0.5) / scale - src.x;
          const distSq = cx * cx + cy * cy;
          if (distSq > totalSq) continue;
          const idx = py * pxW + px;
          const cur = lightLevels[idx] ?? LIGHT_CODE_DARKNESS;
          if (cur === LIGHT_CODE_MAGICAL_DARKNESS && !isHigherMagic) continue;
          const targetCode = distSq <= brightSq ? LIGHT_CODE_BRIGHT : LIGHT_CODE_DIM;
          if (cur === LIGHT_CODE_MAGICAL_DARKNESS || targetCode > cur) {
            lightLevels[idx] = targetCode;
          }
        }
      }

      paintLightGradient(tintCtx, src, scale, pxW, pxH, poly);
    }
  }
}

interface ObserverRaster {
  readonly token: Token;
  readonly profile: VisionProfile;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly losMask: Uint8ClampedArray;
}

function buildObserverRasters(
  map: GameMap,
  observers: readonly Token[],
  pxW: number,
  pxH: number,
  scale: number,
  options?: FogRenderOptions,
): ObserverRaster[] {
  const scratch = document.createElement('canvas');
  scratch.width = pxW;
  scratch.height = pxH;
  const sCtx = scratch.getContext('2d');
  if (!sCtx) return [];

  const bounds = { width: map.width, height: map.height };
  const diagCells = Math.hypot(map.width, map.height) + 1;
  const out: ObserverRaster[] = [];

  for (const token of observers) {
    const profile = resolveRendererTokenProfile(token, map, options);
    const maxCells =
      profile.normalRangeFeet !== null ? maxVisionRangeFeet(profile, 0) / 5 : diagCells;
    const side = spaceSquares(token.size);
    const x0 = token.position.x / WORLD_UNITS_PER_CELL;
    const y0 = token.position.y / WORLD_UNITS_PER_CELL;
    const x1 = x0 + side;
    const y1 = y0 + side;

    if (maxCells <= 0) {
      out.push({ token, profile, x0, y0, x1, y1, losMask: new Uint8ClampedArray(pxW * pxH * 4) });
      continue;
    }

    const poly = computeVisibilityPolygon({ x: x0 + side * 0.5, y: y0 + side * 0.5 }, maxCells, map.walls, {
      layer: 'surface',
      mode: 'vision',
      bounds,
      circleSegments: 72,
    });

    sCtx.clearRect(0, 0, pxW, pxH);
    if (poly.length >= 3) {
      sCtx.fillStyle = '#ffffff';
      tracePoly(sCtx, poly, scale);
      sCtx.fill();
    }
    const losMask = sCtx.getImageData(0, 0, pxW, pxH).data;
    out.push({ token, profile, x0, y0, x1, y1, losMask });
  }
  return out;
}

function bestPerceptionForPixel(
  cx: number,
  cy: number,
  idx: number,
  lightLevels: Uint8Array,
  rasters: readonly ObserverRaster[],
): number {
  const light = lightLevelFromCode(lightLevels[idx] ?? LIGHT_CODE_DARKNESS);
  const maskAlphaOffset = idx * 4 + 3;
  let best = PERCEPTION_CODE_UNSEEN;

  for (const obs of rasters) {
    if ((obs.losMask[maskAlphaOffset] ?? 0) < 128) continue;
    const dx = cx < obs.x0 ? obs.x0 - cx : cx > obs.x1 ? cx - obs.x1 : 0;
    const dy = cy < obs.y0 ? obs.y0 - cy : cy > obs.y1 ? cy - obs.y1 : 0;
    const distanceFeet = Math.hypot(dx, dy) * 5;
    const kind = classifyPerception(obs.profile, {
      distanceFeet,
      light,
      hasLineOfSight: true,
      targetGrounded: false,
    });
    const code = perceptionCodeFromKind(kind);
    if (code > best) best = code;
  }
  return best;
}

/**
 * Compõe o buffer de máscara de visão/iluminação (`mask`) e a camada aditiva de cores
 * de luz (`tintCanvas`) em sub-resolução suave por polígonos ocluídos.
 *
 * A máscara guarda dados (não cor) nos quatro canais, inclusive com alfa 0
 * (`MASK_BRIGHT`). Por isso é um buffer de bytes e não um `<canvas>`: o canvas
 * guarda a cor pré-multiplicada pelo alfa e zera o RGB dos pixels com alfa 0,
 * o que deixava o mapa todo preto.
 */
/** Máscara RGBA em bytes crus (sem pré-multiplicação), redimensionada pelo `composeSmooth2dVisionAndLight`. */
export interface VisionMaskBuffer {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export function composeSmooth2dVisionAndLight(
  mask: VisionMaskBuffer,
  tintCanvas: HTMLCanvasElement,
  map: GameMap,
  tokens: readonly Token[],
  viewer: FogViewer,
  options?: FogRenderOptions,
): Smooth2dComposeResult {
  const selfUnseenTokenIds = new Set<string>();
  const scale = pxScaleForMap(map.width, map.height);
  const pxW = map.width * scale;
  const pxH = map.height * scale;

  if (mask.width !== pxW || mask.height !== pxH || mask.data.length !== pxW * pxH * 4) {
    mask.width = pxW;
    mask.height = pxH;
    mask.data = new Uint8ClampedArray(pxW * pxH * 4);
  }
  if (tintCanvas.width !== pxW || tintCanvas.height !== pxH) {
    tintCanvas.width = pxW;
    tintCanvas.height = pxH;
  }

  const tCtx = tintCanvas.getContext('2d');
  if (!tCtx) return { selfUnseenTokenIds };

  tCtx.clearRect(0, 0, pxW, pxH);
  const sources = resolveActiveLightSources(map, tokens, options?.bakedPropLights);
  const lightLevels = new Uint8Array(pxW * pxH);
  fillLightLevelBuffer(lightLevels, pxW, pxH, scale, map, sources, tCtx);

  const manual = decodeFogBits(map.fog.manual, map.width, map.height);
  const out = mask.data;

  const isPreview =
    viewer.role === 'gm' && viewer.previewTokenId !== undefined && viewer.previewTokenId !== null;
  const previewToken = isPreview
    ? tokens.find((t) => t.id === viewer.previewTokenId && t.mapId === map.id)
    : undefined;

  if (viewer.role === 'gm' && !previewToken) {
    const observers = map.fog.autoEnabled
      ? tokens.filter((t) => t.mapId === map.id && isPlayerOwnedToken(t, options?.characters))
      : [];
    const rasters = buildObserverRasters(map, observers, pxW, pxH, scale, options);

    for (let py = 0; py < pxH; py++) {
      const cy = (py + 0.5) / scale;
      const cellRow = Math.min(map.height - 1, Math.floor(cy));
      for (let px = 0; px < pxW; px++) {
        const cx = (px + 0.5) / scale;
        const cellCol = Math.min(map.width - 1, Math.floor(cx));
        const idx = py * pxW + px;
        const offset = idx * 4;
        if (getFogCell(manual, map.width, cellCol, cellRow)) {
          writePixel(out, offset, MASK_GM_MANUAL);
        } else {
          const base = maskRgbaForGmLightCode(lightLevels[idx] ?? LIGHT_CODE_DARKNESS);
          if (map.fog.autoEnabled && bestPerceptionForPixel(cx, cy, idx, lightLevels, rasters) === PERCEPTION_CODE_UNSEEN) {
            writePixel(out, offset, [
              Math.max(base[0], MASK_GM_AUTO_OUTSIDE[0]),
              Math.min(base[1], MASK_GM_AUTO_OUTSIDE[1]),
              Math.max(base[2], MASK_GM_AUTO_OUTSIDE[2]),
              Math.max(base[3], MASK_GM_AUTO_OUTSIDE[3]),
            ]);
          } else {
            writePixel(out, offset, base);
          }
        }
      }
    }
    return { selfUnseenTokenIds };
  }

  // Visão de jogador ou pré-visualização de token do mestre.
  const observers = previewToken
    ? [previewToken]
    : tokens.filter((t) => t.mapId === map.id && isViewerObserverToken(t, viewer.playerId, options?.characters));
  const rasters = map.fog.autoEnabled ? buildObserverRasters(map, observers, pxW, pxH, scale, options) : [];

  let explored: Uint8Array | null = null;
  if (map.fog.autoEnabled && map.fog.rememberExplored) {
    if (previewToken) {
      const keys = new Set<string>(previewToken.ownerIds);
      const charOwner =
        previewToken.characterId !== null ? options?.characters?.[previewToken.characterId]?.ownerId : undefined;
      if (charOwner) keys.add(charOwner);
      if (keys.size === 0) keys.add(previewToken.id);
      let merged = emptyFogBits(map.width, map.height);
      let hasAny = false;
      for (const k of keys) {
        const enc = map.fog.explored[k];
        if (enc !== undefined) {
          merged = unionFogBits(merged, decodeFogBits(enc, map.width, map.height));
          hasAny = true;
        }
      }
      if (hasAny) explored = merged;
    } else {
      const enc = map.fog.explored[viewer.playerId];
      if (enc !== undefined) explored = decodeFogBits(enc, map.width, map.height);
    }
  }

  const manualColor = previewToken ? MASK_GM_PREVIEW_MANUAL : MASK_UNSEEN;

  for (let py = 0; py < pxH; py++) {
    const cy = (py + 0.5) / scale;
    const cellRow = Math.min(map.height - 1, Math.floor(cy));
    for (let px = 0; px < pxW; px++) {
      const cx = (px + 0.5) / scale;
      const cellCol = Math.min(map.width - 1, Math.floor(cx));
      const idx = py * pxW + px;
      const offset = idx * 4;

      if (getFogCell(manual, map.width, cellCol, cellRow)) {
        writePixel(out, offset, manualColor);
      } else if (map.fog.autoEnabled) {
        const code = bestPerceptionForPixel(cx, cy, idx, lightLevels, rasters);
        const seen = explored !== null && getFogCell(explored, map.width, cellCol, cellRow);
        writePixel(out, offset, maskRgbaForPerceptionCode(code, seen, MASK_UNSEEN));
      } else {
        const lightCode = lightLevels[idx] ?? LIGHT_CODE_DARKNESS;
        const rgba =
          lightCode === LIGHT_CODE_DARKNESS && !previewToken
            ? MASK_DARKNESS_UNLIT
            : maskRgbaForUnfoggedLightCode(lightCode);
        writePixel(out, offset, rgba);
      }
    }
  }

  // Marca tokens do jogador que estão no próprio centro em escuridão completa (ex.: humano sem tocha).
  if (map.fog.autoEnabled) {
    for (const obs of rasters) {
      const side = tokenSide(obs.token.size);
      const centerCellX = (obs.token.position.x + side * 0.5) / WORLD_UNITS_PER_CELL;
      const centerCellY = (obs.token.position.y + side * 0.5) / WORLD_UNITS_PER_CELL;
      const px = Math.min(pxW - 1, Math.max(0, Math.floor(centerCellX * scale)));
      const py = Math.min(pxH - 1, Math.max(0, Math.floor(centerCellY * scale)));
      const idx = py * pxW + px;
      const code = bestPerceptionForPixel(centerCellX, centerCellY, idx, lightLevels, rasters);
      if (code === PERCEPTION_CODE_UNSEEN) selfUnseenTokenIds.add(obs.token.id);
    }
  }

  return { selfUnseenTokenIds };
}
