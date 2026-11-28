import type { Condition } from '../schemas/common';
import type { Creature } from '../schemas/creature';
import type { Effect } from '../schemas/effect';
import { effectiveConditions } from './conditions';

/**
 * Regras puras de iluminação e visão de D&D 2024 (SRD 5.2.1), sem dependências
 * de UI, Electron, PixiJS ou Node (nota 0061).
 */

export type LightLevel = 'bright' | 'dim' | 'darkness' | 'magical_darkness';
export type MapEnvironment = 'exterior' | 'interior';
export type TimeOfDay = 'day' | 'dawn' | 'dusk' | 'twilight' | 'night';
export type PerceptionKind = 'bright_color' | 'dim_color' | 'darkvision_bw' | 'sense_only' | 'unseen';

export interface VisionProfile {
  /** Alcance da visão normal em áreas iluminadas (em pés); `null` = sem limite dentro da luz desobstruída; `0` se cego/inconsciente. */
  normalRangeFeet: number | null;
  /** Alcance de Darkvision não mágica em pés (`0` se não tiver ou estiver cego). */
  darkvisionFeet: number;
  /** Alcance em pés que enxerga normalmente mesmo na escuridão mágica (ex.: Devil's Sight; `0` se não tiver ou estiver cego). */
  magicalDarknessVisionFeet: number;
  /** Alcance de Blindsight em pés (funciona mesmo cego e na escuridão mágica; bloqueado por cobertura total/paredes). */
  blindsightFeet: number;
  /** Alcance de Tremorsense em pés (detecta criaturas no chão; ignora escuridão, cegueira e paredes). */
  tremorsenseFeet: number;
  /** Alcance de Truesight em pés (enxerga normalmente na escuridão comum e mágica; `0` se cego). */
  truesightFeet: number;
  /** Verdadeiro quando sentidos baseados em visão estão desabilitados (`blinded` ou `unconscious`). */
  blinded: boolean;
}

export const DEFAULT_VISION_PROFILE: VisionProfile = {
  normalRangeFeet: null,
  darkvisionFeet: 0,
  magicalDarknessVisionFeet: 0,
  blindsightFeet: 0,
  tremorsenseFeet: 0,
  truesightFeet: 0,
  blinded: false,
};

export interface LightContribution {
  kind: 'light';
  level: 'bright' | 'dim';
  /** Círculo da magia se for luz mágica (`0` = truque, `1`–`9` = magia), ou `null` para luz não mágica (sol, tocha, lanterna). */
  spellLevel: number | null;
}

export interface DarknessContribution {
  kind: 'darkness';
  /** Círculo da magia de escuridão mágica (ex.: `2` para a magia Darkness). */
  spellLevel: number;
}

export type IlluminationContribution = LightContribution | DarknessContribution;

export interface PerceptionInput {
  distanceFeet: number;
  light: LightLevel;
  hasLineOfSight: boolean;
  targetGrounded?: boolean | undefined;
}

export interface LightPreset {
  id: string;
  name: string;
  kind: 'light' | 'darkness';
  brightFeet: number;
  dimFeet: number;
  darknessFeet: number;
  spellLevel: number | null;
  angleDeg: number;
  color: string;
  flicker: boolean;
  concentration?: boolean;
  spellId?: string;
  itemId?: string;
}

/** Predefinições de fontes de luz de equipamento do SRD 5.2.1. */
export const SRD_LIGHT_GEAR_PRESETS: readonly LightPreset[] = [
  {
    id: 'torch',
    name: 'Tocha',
    kind: 'light',
    brightFeet: 20,
    dimFeet: 20,
    darknessFeet: 0,
    spellLevel: null,
    angleDeg: 360,
    color: '#ff9442',
    flicker: true,
    itemId: 'torch',
  },
  {
    id: 'candle',
    name: 'Vela',
    kind: 'light',
    brightFeet: 5,
    dimFeet: 5,
    darknessFeet: 0,
    spellLevel: null,
    angleDeg: 360,
    color: '#ffb86b',
    flicker: true,
    itemId: 'candle',
  },
  {
    id: 'lamp',
    name: 'Lamparina',
    kind: 'light',
    brightFeet: 15,
    dimFeet: 30,
    darknessFeet: 0,
    spellLevel: null,
    angleDeg: 360,
    color: '#ffaa4c',
    flicker: true,
    itemId: 'lamp',
  },
  {
    id: 'hooded_lantern',
    name: 'Lanterna Furta-Fogo',
    kind: 'light',
    brightFeet: 30,
    dimFeet: 30,
    darknessFeet: 0,
    spellLevel: null,
    angleDeg: 360,
    color: '#ffb454',
    flicker: true,
    itemId: 'hooded_lantern',
  },
  {
    id: 'hooded_lantern_lowered',
    name: 'Lanterna Furta-Fogo (tampa fechada)',
    kind: 'light',
    brightFeet: 0,
    dimFeet: 5,
    darknessFeet: 0,
    spellLevel: null,
    angleDeg: 360,
    color: '#ffb454',
    flicker: true,
  },
  {
    id: 'bullseye_lantern',
    name: 'Lanterna Alvo (cone)',
    kind: 'light',
    brightFeet: 60,
    dimFeet: 60,
    darknessFeet: 0,
    spellLevel: null,
    angleDeg: 60,
    color: '#ffd280',
    flicker: true,
    itemId: 'bullseye_lantern',
  },
];

/** Predefinições de magias de luz e escuridão do SRD 5.2.1. */
export const SRD_LIGHT_SPELL_PRESETS: readonly LightPreset[] = [
  {
    id: 'light',
    name: 'Light',
    kind: 'light',
    brightFeet: 20,
    dimFeet: 20,
    darknessFeet: 0,
    spellLevel: 0,
    angleDeg: 360,
    color: '#fff1c4',
    flicker: false,
    spellId: 'light',
  },
  {
    id: 'dancing_lights',
    name: 'Dancing Lights',
    kind: 'light',
    brightFeet: 0,
    dimFeet: 10,
    darknessFeet: 0,
    spellLevel: 0,
    angleDeg: 360,
    color: '#c8e4ff',
    flicker: false,
    concentration: true,
    spellId: 'dancing_lights',
  },
  {
    id: 'continual_flame',
    name: 'Continual Flame',
    kind: 'light',
    brightFeet: 20,
    dimFeet: 20,
    darknessFeet: 0,
    spellLevel: 2,
    angleDeg: 360,
    color: '#ff9d3b',
    flicker: true,
    spellId: 'continual_flame',
  },
  {
    id: 'daylight',
    name: 'Daylight',
    kind: 'light',
    brightFeet: 60,
    dimFeet: 60,
    darknessFeet: 0,
    spellLevel: 3,
    angleDeg: 360,
    color: '#fff9e8',
    flicker: false,
    spellId: 'daylight',
  },
  {
    id: 'darkness',
    name: 'Darkness',
    kind: 'darkness',
    brightFeet: 0,
    dimFeet: 0,
    darknessFeet: 15,
    spellLevel: 2,
    angleDeg: 360,
    color: '#000000',
    flicker: false,
    concentration: true,
    spellId: 'darkness',
  },
];

export function lightPresetForItem(itemId: string): LightPreset | undefined {
  return SRD_LIGHT_GEAR_PRESETS.find((p) => p.itemId === itemId);
}

export function lightPresetForSpell(spellId: string): LightPreset | undefined {
  return SRD_LIGHT_SPELL_PRESETS.find((p) => p.spellId === spellId);
}

/** Luz ambiente base a partir do ambiente (`exterior`/`interior`) e do horário do dia. */
export function ambientLightLevel(
  environment: MapEnvironment,
  timeOfDay: TimeOfDay,
  override?: 'bright' | 'dim' | 'darkness',
): 'bright' | 'dim' | 'darkness' {
  if (override !== undefined) return override;
  if (environment === 'interior') return 'darkness';
  switch (timeOfDay) {
    case 'day':
      return 'bright';
    case 'dawn':
    case 'dusk':
    case 'twilight':
      return 'dim';
    case 'night':
      return 'darkness';
  }
}

const LIGHT_RANK: Record<'darkness' | 'dim' | 'bright', number> = {
  darkness: 0,
  dim: 1,
  bright: 2,
};

/**
 * Resolve o nível efetivo de iluminação num ponto combinando luz ambiente,
 * fontes de luz e zonas de escuridão mágica (SRD 5.2.1): escuridão mágica
 * suprime luz não mágica e luz mágica de círculo menor ou igual ao dela.
 */
export function resolveEffectiveLight(
  ambient: 'bright' | 'dim' | 'darkness',
  contributions: readonly IlluminationContribution[],
): LightLevel {
  let maxDarknessSpellLevel: number | null = null;
  for (const c of contributions) {
    if (c.kind === 'darkness' && (maxDarknessSpellLevel === null || c.spellLevel > maxDarknessSpellLevel)) {
      maxDarknessSpellLevel = c.spellLevel;
    }
  }

  if (maxDarknessSpellLevel !== null) {
    let bestOvercoming: 'bright' | 'dim' | null = null;
    for (const c of contributions) {
      if (c.kind !== 'light' || c.spellLevel === null || c.spellLevel <= maxDarknessSpellLevel) continue;
      if (c.level === 'bright') return 'bright';
      bestOvercoming = 'dim';
    }
    return bestOvercoming ?? 'magical_darkness';
  }

  let best: 'bright' | 'dim' | 'darkness' = ambient;
  for (const c of contributions) {
    if (c.kind === 'light' && LIGHT_RANK[c.level] > LIGHT_RANK[best]) {
      best = c.level;
    }
  }
  return best;
}

/**
 * Classifica como um observador com `profile` percebe um ponto ou alvo
 * considerando distância, nível de luz, linha de visão e se o alvo toca o chão.
 */
export function classifyPerception(profile: VisionProfile, input: PerceptionInput): PerceptionKind {
  const { distanceFeet, light, hasLineOfSight } = input;
  const grounded = input.targetGrounded ?? true;
  const canTremorsense = profile.tremorsenseFeet > 0 && distanceFeet <= profile.tremorsenseFeet && grounded;

  if (!hasLineOfSight) {
    return canTremorsense ? 'sense_only' : 'unseen';
  }

  const canBlindsight = profile.blindsightFeet > 0 && distanceFeet <= profile.blindsightFeet;
  const senseFallback: PerceptionKind = canBlindsight || canTremorsense ? 'sense_only' : 'unseen';

  if (profile.blinded) {
    return senseFallback;
  }

  if (profile.truesightFeet > 0 && distanceFeet <= profile.truesightFeet) {
    return 'bright_color';
  }

  const hasMagicalDarkvision = profile.magicalDarknessVisionFeet > 0 && distanceFeet <= profile.magicalDarknessVisionFeet;
  if (light === 'magical_darkness') {
    return hasMagicalDarkvision ? 'bright_color' : senseFallback;
  }

  const hasDarkvision = profile.darkvisionFeet > 0 && distanceFeet <= profile.darkvisionFeet;
  if (light === 'darkness') {
    if (hasMagicalDarkvision) return 'bright_color';
    if (hasDarkvision) return 'darkvision_bw';
    return senseFallback;
  }

  const withinNormal =
    profile.normalRangeFeet === null || (profile.normalRangeFeet > 0 && distanceFeet <= profile.normalRangeFeet);

  if (light === 'dim') {
    if (hasMagicalDarkvision || hasDarkvision) return 'bright_color';
    if (withinNormal) return 'dim_color';
    return senseFallback;
  }

  if (withinNormal || hasDarkvision || hasMagicalDarkvision) {
    return 'bright_color';
  }
  return senseFallback;
}

export function isPerceived(kind: PerceptionKind): boolean {
  return kind !== 'unseen';
}

/** Maior distância em pés em que o perfil consegue perceber algo (usando `fallbackNormalCapFeet` se a visão normal não tiver teto). */
export function maxVisionRangeFeet(profile: VisionProfile, fallbackNormalCapFeet: number): number {
  if (profile.blinded) {
    return Math.max(profile.blindsightFeet, profile.tremorsenseFeet);
  }
  const normal = profile.normalRangeFeet === null ? fallbackNormalCapFeet : profile.normalRangeFeet;
  return Math.max(
    normal,
    profile.darkvisionFeet,
    profile.magicalDarknessVisionFeet,
    profile.blindsightFeet,
    profile.tremorsenseFeet,
    profile.truesightFeet,
  );
}

/** Deriva o `VisionProfile` a partir dos efeitos ativos e condições efetivas da criatura. */
export function deriveVisionProfile(effects: readonly Effect[], activeConditions: Iterable<Condition>): VisionProfile {
  const effective = effectiveConditions(activeConditions);
  const blinded = effective.has('blinded') || effective.has('unconscious');

  let darkvisionBase = 0;
  let darkvisionExtend = 0;
  let magicalDarknessBase = 0;
  let magicalDarknessExtend = 0;
  let blindsightFeet = 0;
  let tremorsenseFeet = 0;
  let truesightFeet = 0;

  let hasSet = false;
  let hasUnlimitedSet = false;
  let maxFiniteSet = 0;
  let minCap: number | null = null;

  for (const effect of effects) {
    if (effect.type === 'grant_sense') {
      if (effect.sense === 'darkvision') {
        if (effect.magicalDarkness) {
          if (effect.extend) magicalDarknessExtend += effect.range;
          else if (effect.range > magicalDarknessBase) magicalDarknessBase = effect.range;
        } else {
          if (effect.extend) darkvisionExtend += effect.range;
          else if (effect.range > darkvisionBase) darkvisionBase = effect.range;
        }
      } else if (effect.sense === 'blindsight') {
        if (effect.extend) blindsightFeet += effect.range;
        else if (effect.range > blindsightFeet) blindsightFeet = effect.range;
      } else if (effect.sense === 'tremorsense') {
        if (effect.extend) tremorsenseFeet += effect.range;
        else if (effect.range > tremorsenseFeet) tremorsenseFeet = effect.range;
      } else {
        if (effect.extend) truesightFeet += effect.range;
        else if (effect.range > truesightFeet) truesightFeet = effect.range;
      }
    } else if (effect.type === 'vision_range') {
      if (effect.mode === 'cap') {
        if (effect.range !== 'unlimited' && (minCap === null || effect.range < minCap)) {
          minCap = effect.range;
        }
      } else {
        hasSet = true;
        if (effect.range === 'unlimited') {
          hasUnlimitedSet = true;
        } else if (effect.range > maxFiniteSet) {
          maxFiniteSet = effect.range;
        }
      }
    }
  }

  let normalRangeFeet: number | null = !hasSet || hasUnlimitedSet ? null : maxFiniteSet;
  if (minCap !== null) {
    normalRangeFeet = normalRangeFeet === null ? minCap : Math.min(normalRangeFeet, minCap);
  }

  const darkvisionFeet = darkvisionBase + darkvisionExtend;
  const magicalDarknessVisionFeet = magicalDarknessBase + magicalDarknessExtend;

  if (blinded) {
    return {
      normalRangeFeet: 0,
      darkvisionFeet: 0,
      magicalDarknessVisionFeet: 0,
      blindsightFeet,
      tremorsenseFeet,
      truesightFeet: 0,
      blinded: true,
    };
  }

  return {
    normalRangeFeet,
    darkvisionFeet,
    magicalDarknessVisionFeet,
    blindsightFeet,
    tremorsenseFeet,
    truesightFeet,
    blinded: false,
  };
}

/** Deriva o `VisionProfile` de uma criatura/monstro do compêndio e suas condições ativas. */
export function creatureVisionProfile(
  creature: Pick<Creature, 'effects' | 'traits'>,
  activeConditions: readonly Condition[] = [],
): VisionProfile {
  const allEffects: Effect[] = [...creature.effects, ...creature.traits.flatMap((t) => t.effects)];
  return deriveVisionProfile(allEffects, activeConditions);
}
