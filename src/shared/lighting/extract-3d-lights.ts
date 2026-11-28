import type { MapLayer } from '../collision/types';
import { defaultMapLighting, type MapLightingConfig } from './types';

/**
 * Extrator determinístico de fontes de luz embutidas em mapas 3D (`VttMapDocument`),
 * compartilhado entre o Host (validação de proximidade) e o renderizador 3D/2D (nota 0081).
 */

export interface ExtractedPropLight {
  readonly id: string;
  readonly propIndex: number;
  readonly key: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly layer: MapLayer;
  readonly elevationFeet: number;
  readonly brightFeet: number;
  readonly dimFeet: number;
  readonly color: string;
  readonly flicker: boolean;
}

export function propLightId(propIndex: number, key: string): string {
  return `prop:${propIndex}:${key}`.slice(0, 120);
}

interface PropLightProfile {
  name: string;
  brightFeet: number;
  dimFeet: number;
  color: string;
  flicker: boolean;
  elevationFeet: number;
}

function classifyPropLight(key: string): PropLightProfile | null {
  const lower = key.toLowerCase();
  if (/watch_brazier|brazier/.test(lower)) {
    return { name: 'Braseiro', brightFeet: 20, dimFeet: 20, color: '#ff7824', flicker: true, elevationFeet: 5.5 };
  }
  if (/wall_torch/.test(lower)) {
    return { name: 'Tocha de parede', brightFeet: 20, dimFeet: 20, color: '#ff8c2e', flicker: true, elevationFeet: 7.5 };
  }
  if (/wall_cresset|cresset/.test(lower)) {
    return { name: 'Arandela de fogo', brightFeet: 20, dimFeet: 20, color: '#ff8429', flicker: true, elevationFeet: 7.0 };
  }
  if (/standing_torch|torch/.test(lower)) {
    return { name: 'Tocha', brightFeet: 20, dimFeet: 20, color: '#ff8a2b', flicker: true, elevationFeet: 7.0 };
  }
  if (/lantern|lamp|campfire|hearth|fireplace/.test(lower)) {
    return { name: 'Lanterna / Fogueira', brightFeet: 15, dimFeet: 15, color: '#ffa64a', flicker: true, elevationFeet: 4.5 };
  }
  return null;
}

/** Extrai todas as fontes de luz emissoras de props do JSON de um mapa 3D (`VttMapDocument`). */
export function extractPropLightsFrom3dMapDocument(raw: unknown): ExtractedPropLight[] {
  if (!raw || typeof raw !== 'object') return [];
  const doc = raw as Record<string, unknown>;
  const propsRaw = Array.isArray(doc['props']) ? doc['props'] : [];
  const out: ExtractedPropLight[] = [];

  for (let propIndex = 0; propIndex < propsRaw.length; propIndex++) {
    const item: unknown = propsRaw[propIndex];
    if (!item || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;
    if (typeof p['key'] !== 'string') continue;
    const profile = classifyPropLight(p['key']);
    if (!profile) continue;

    const x = typeof p['tileX'] === 'number' && Number.isFinite(p['tileX']) ? p['tileX'] : 0;
    const y = typeof p['tileZ'] === 'number' && Number.isFinite(p['tileZ']) ? p['tileZ'] : 0;
    const yOffset = typeof p['yOffsetFeet'] === 'number' && Number.isFinite(p['yOffsetFeet']) ? p['yOffsetFeet'] : 0;
    const layer: MapLayer = p['layer'] === 'interior' ? 'interior' : 'surface';

    out.push({
      id: propLightId(propIndex, p['key']),
      propIndex,
      key: p['key'],
      name: profile.name,
      x,
      y,
      layer,
      elevationFeet: profile.elevationFeet + yOffset,
      brightFeet: profile.brightFeet,
      dimFeet: profile.dimFeet,
      color: profile.color,
      flicker: profile.flicker,
    });
  }
  return out;
}

/** Mapeia o preset de iluminação de um `VttMapDocument` para `MapLightingConfig` (ambiente e horário). */
export function extractDefaultLightingFrom3dMapDocument(raw: unknown): MapLightingConfig {
  if (!raw || typeof raw !== 'object') return defaultMapLighting();
  const doc = raw as Record<string, unknown>;
  const settings = doc['settings'];
  if (!settings || typeof settings !== 'object') return defaultMapLighting();
  const lighting = (settings as Record<string, unknown>)['lighting'];
  if (!lighting || typeof lighting !== 'object') return defaultMapLighting();
  const preset = (lighting as Record<string, unknown>)['preset'];
  switch (preset) {
    case 'dungeon':
      return defaultMapLighting('interior', 'night');
    case 'night':
      return defaultMapLighting('exterior', 'night');
    case 'twilight':
      return defaultMapLighting('exterior', 'twilight');
    case 'golden_hour':
      return defaultMapLighting('exterior', 'dusk');
    case 'daylight':
    default:
      return defaultMapLighting('exterior', 'day');
  }
}
