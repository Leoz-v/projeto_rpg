import {
  computeAllPlayersVision,
  computePlayerVision,
  decodeFogBits,
  type FogCell,
  type GameMap,
  getFogCell,
  type Point,
  type Role,
  type Token,
  WORLD_UNITS_PER_CELL,
} from '../../../shared/protocol';

/**
 * Renderização da névoa de guerra (nota 0056), desacoplada do PixiJS:
 * preenche um buffer RGBA de 1 pixel por célula (`width × height`) para ser
 * desenhado com `scaleMode: 'nearest'` sobre o mapa.
 */

export type FogTool = 'none' | 'brush-cover' | 'brush-reveal' | 'rect-cover' | 'rect-reveal';

export interface FogViewer {
  role: Role;
  playerId: string;
}

const RGBA_CLEAR = [0, 0, 0, 0] as const;
/** Névoa opaca para jogadores (manual ou nunca explorada). */
const RGBA_PLAYER_OPAQUE = [10, 9, 18, 255] as const;
/** Véu semitransparente para células lembradas fora da visão atual. */
const RGBA_PLAYER_EXPLORED = [10, 9, 18, 145] as const;
/** Névoa manual vista pelo mestre (semitransparente em índigo para distinguir da automática). */
const RGBA_GM_MANUAL = [22, 16, 52, 155] as const;
/** Área fora da visão de todos os jogadores vista pelo mestre (véu leve). */
const RGBA_GM_AUTO = [10, 9, 18, 70] as const;

function writePixel(data: Uint8ClampedArray, offset: number, rgba: readonly [number, number, number, number]): void {
  data[offset] = rgba[0];
  data[offset + 1] = rgba[1];
  data[offset + 2] = rgba[2];
  data[offset + 3] = rgba[3];
}

/** Preenche `data` (`width * height * 4` bytes RGBA) com a névoa vista por `viewer`. */
export function fillFogImageData(data: Uint8ClampedArray, map: GameMap, tokens: readonly Token[], viewer: FogViewer): void {
  const { width, height, fog } = map;
  const manual = decodeFogBits(fog.manual, width, height);

  if (viewer.role === 'gm') {
    const anyVision = fog.autoEnabled ? computeAllPlayersVision(map, tokens) : null;
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const offset = (row * width + col) * 4;
        if (getFogCell(manual, width, col, row)) {
          writePixel(data, offset, RGBA_GM_MANUAL);
        } else if (anyVision && !getFogCell(anyVision, width, col, row)) {
          writePixel(data, offset, RGBA_GM_AUTO);
        } else {
          writePixel(data, offset, RGBA_CLEAR);
        }
      }
    }
    return;
  }

  const vision = fog.autoEnabled ? computePlayerVision(map, tokens, viewer.playerId) : null;
  const exploredBase64 = fog.autoEnabled && fog.rememberExplored ? fog.explored[viewer.playerId] : undefined;
  const explored = exploredBase64 !== undefined ? decodeFogBits(exploredBase64, width, height) : null;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const offset = (row * width + col) * 4;
      if (getFogCell(manual, width, col, row)) {
        writePixel(data, offset, RGBA_PLAYER_OPAQUE);
      } else if (vision) {
        if (getFogCell(vision, width, col, row)) {
          writePixel(data, offset, RGBA_CLEAR);
        } else if (explored && getFogCell(explored, width, col, row)) {
          writePixel(data, offset, RGBA_PLAYER_EXPLORED);
        } else {
          writePixel(data, offset, RGBA_PLAYER_OPAQUE);
        }
      } else {
        writePixel(data, offset, RGBA_CLEAR);
      }
    }
  }
}

/** Converte coordenadas de mundo para a célula do grid sob o ponteiro, ou `null` se fora do mapa. */
export function worldToFogCell(world: Point, map: Pick<GameMap, 'width' | 'height'>): FogCell | null {
  const x = Math.floor(world.x / WORLD_UNITS_PER_CELL);
  const y = Math.floor(world.y / WORLD_UNITS_PER_CELL);
  if (x < 0 || x >= map.width || y < 0 || y >= map.height) return null;
  return { x, y };
}

/** Converte coordenadas de mundo para a célula mais próxima dentro do mapa (para arrasto de retângulo). */
export function clampFogCell(world: Point, map: Pick<GameMap, 'width' | 'height'>): FogCell {
  const x = Math.min(map.width - 1, Math.max(0, Math.floor(world.x / WORLD_UNITS_PER_CELL)));
  const y = Math.min(map.height - 1, Math.max(0, Math.floor(world.y / WORLD_UNITS_PER_CELL)));
  return { x, y };
}

/** Assinatura do estado que afeta o desenho da névoa: só redesenha a textura quando muda. */
export function fogSignature(map: GameMap | null, tokens: readonly Token[], viewer: FogViewer): string {
  if (!map) return '';
  const { fog } = map;
  const parts = [
    map.id,
    `${map.width}x${map.height}`,
    viewer.role,
    viewer.playerId,
    fog.manual,
    fog.autoEnabled ? '1' : '0',
    String(fog.visionFeet),
    fog.rememberExplored ? '1' : '0',
    viewer.role === 'gm' ? '' : (fog.explored[viewer.playerId] ?? ''),
  ];
  if (fog.autoEnabled) {
    for (const t of tokens) {
      if (t.mapId !== map.id) continue;
      if (viewer.role === 'gm' ? t.ownerIds.length === 0 : !t.ownerIds.includes(viewer.playerId)) continue;
      parts.push(`${t.id}:${t.position.x},${t.position.y}:${t.size}:${t.visionFeet ?? ''}`);
    }
  }
  return parts.join('|');
}
