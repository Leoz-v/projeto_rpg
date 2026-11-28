import type { LightPreset, MapEnvironment, TimeOfDay, VisionProfile } from 'rules-engine/vision';
import type { AmbientLight, LightAttachment, NewMapLightSource } from '../../../shared/protocol';

/**
 * Tipos e auxiliares puros para os controles de iluminação, paredes/portas e visão na mesa (nota 0081).
 */

export type WallTool = 'none' | 'wall' | 'door' | 'window' | 'terrain_wall' | 'erase';

export const ENVIRONMENT_LABELS: Record<MapEnvironment, string> = {
  exterior: 'Exterior',
  interior: 'Interior',
};

export const TIME_OF_DAY_LABELS: Record<TimeOfDay, string> = {
  day: 'Dia',
  dawn: 'Amanhecer',
  dusk: 'Entardecer',
  twilight: 'Crepúsculo',
  night: 'Noite',
};

export const AMBIENT_OVERRIDE_LABELS: Record<'auto' | AmbientLight, string> = {
  auto: 'Automática',
  bright: 'Luz clara',
  dim: 'Penumbra',
  darkness: 'Escuridão',
};

/** Arredonda uma coordenada em células para o meio-tile mais próximo (`0.5`), dentro do mapa. */
export function snapWallCoord(cellCoord: number, maxCells: number): number {
  const snapped = Math.round(cellCoord * 2) / 2;
  return Math.max(0, Math.min(maxCells, snapped));
}

/** Constrói um `NewMapLightSource` a partir de uma predefinição SRD de equipamento ou magia. */
export function buildLightInputFromPreset(
  preset: LightPreset,
  attach: LightAttachment,
  spellLink?: { characterId: string; spellId: string },
): NewMapLightSource {
  return {
    name: preset.name,
    kind: preset.kind,
    enabled: true,
    brightFeet: preset.brightFeet,
    dimFeet: preset.dimFeet,
    darknessFeet: preset.darknessFeet,
    spellLevel: preset.spellLevel,
    angleDeg: preset.angleDeg,
    directionDeg: 0,
    color: preset.color,
    flicker: preset.flicker,
    layer: 'surface',
    elevationFeet: 5,
    attach,
    ...(spellLink ? { spell: spellLink } : {}),
  };
}

/** Resume o `VisionProfile` calculado pela ficha em linhas legíveis em pt-BR. */
export function formatVisionSummary(profile: VisionProfile): string[] {
  if (profile.blinded) {
    const out = ['Cego (sentidos visuais desativados)'];
    if (profile.blindsightFeet > 0) out.push(`Percepção às Cegas: ${profile.blindsightFeet} ft`);
    if (profile.tremorsenseFeet > 0) out.push(`Sentido Sísmico: ${profile.tremorsenseFeet} ft`);
    return out;
  }
  const lines: string[] = [
    profile.normalRangeFeet === null
      ? 'Visão normal: ilimitada (na luz)'
      : `Visão normal: ${profile.normalRangeFeet} ft`,
  ];
  if (profile.darkvisionFeet > 0) {
    lines.push(`Visão no Escuro: ${profile.darkvisionFeet} ft (P&B na escuridão)`);
  }
  if (profile.magicalDarknessVisionFeet > 0) {
    lines.push(`Escuridão mágica: ${profile.magicalDarknessVisionFeet} ft`);
  }
  if (profile.blindsightFeet > 0) {
    lines.push(`Percepção às Cegas: ${profile.blindsightFeet} ft`);
  }
  if (profile.tremorsenseFeet > 0) {
    lines.push(`Sentido Sísmico: ${profile.tremorsenseFeet} ft`);
  }
  if (profile.truesightFeet > 0) {
    lines.push(`Visão Verdadeira: ${profile.truesightFeet} ft`);
  }
  return lines;
}
