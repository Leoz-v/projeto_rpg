/**
 * User-controllable 3D Lighting System for the PixiJS 3D D&D Map Prototype.
 *
 * Manages:
 *  - 5 D&D mood presets (Daylight, Golden Hour, Twilight, Night, Dungeon) + Custom tuning
 *  - Real-time DirectionalLight (azimuth, elevation, color, intensity, shadows)
 *  - Hemisphere ambient sky/ground fill, canvas sky color, and linear distance fog
 *  - Automatic dynamic PointLight sources for placed light-emitting props
 *    (standing_torch, wall_torch, watch_brazier, wall_cresset, lanterns) and
 *    Magma/Lava terrain tiles, with smooth multi-harmonic fire flicker synced to `Anim`.
 */

import type { Container3D} from '@pixi/3d';
import { PointLight } from '@pixi/3d';
import { METERS_PER_HEIGHT_UNIT, TILE_SIZE_METERS } from '../terrain/constants';
import type { TerrainGrid } from '../terrain/terrainGrid';
import type { PlacedAsset, WorldLabAssetEntry } from './assetManager';
import { stablePhase } from './objectAnimator';
import type { SceneManager } from './sceneManager';
import { isWallDecorEntry } from './wallDecoration';

export type LightingPresetId = 'daylight' | 'golden_hour' | 'twilight' | 'night' | 'dungeon' | 'custom';

export interface LightingSettings {
  preset: LightingPresetId;
  sunAzimuthDeg: number;
  sunElevationDeg: number;
  sunIntensity: number;
  sunColor: string;
  ambientIntensity: number;
  skyColor: string;
  groundColor: string;
  backdropColor: string;
  fogEnabled: boolean;
  fogColor: string;
  shadowsEnabled: boolean;
  pointLightsEnabled: boolean;
  pointLightIntensity: number;
  pointLightRangeScale: number;
  lavaGlowEnabled: boolean;
}

export interface PropLightProfile {
  readonly kind: 'torch' | 'wall_torch' | 'brazier' | 'cresset' | 'lantern';
  readonly color: number;
  readonly baseIntensity: number;
  readonly rangeMeters: number;
  readonly radiusMeters: number;
  readonly heightMeters: number;
  readonly forwardOffsetMeters: number;
  readonly flickerAmount: number;
}

export interface LavaLightCluster {
  readonly tileX: number;
  readonly tileZ: number;
  readonly heightUnits: number;
  readonly tileCount: number;
}

interface ManagedPointLight {
  readonly light: PointLight;
  readonly baseIntensity: number;
  readonly baseRange: number;
  readonly flickerAmount: number;
  readonly phase: number;
  readonly sourceKind: 'prop' | 'lava';
}

export const LIGHTING_PRESETS: Record<Exclude<LightingPresetId, 'custom'>, LightingSettings> = {
  daylight: {
    preset: 'daylight',
    sunAzimuthDeg: 320,
    sunElevationDeg: 48,
    sunIntensity: 2.55,
    sunColor: '#fff5e4',
    ambientIntensity: 0.72,
    skyColor: '#c6ddf5',
    groundColor: '#5c5243',
    backdropColor: '#8ea9c4',
    fogEnabled: true,
    fogColor: '#99b2c9',
    shadowsEnabled: true,
    pointLightsEnabled: true,
    pointLightIntensity: 1.0,
    pointLightRangeScale: 1.0,
    lavaGlowEnabled: true,
  },
  golden_hour: {
    preset: 'golden_hour',
    sunAzimuthDeg: 258,
    sunElevationDeg: 21,
    sunIntensity: 2.35,
    sunColor: '#ffae63',
    ambientIntensity: 0.48,
    skyColor: '#e69b75',
    groundColor: '#3f2c24',
    backdropColor: '#bd7c5c',
    fogEnabled: true,
    fogColor: '#c28567',
    shadowsEnabled: true,
    pointLightsEnabled: true,
    pointLightIntensity: 1.25,
    pointLightRangeScale: 1.05,
    lavaGlowEnabled: true,
  },
  twilight: {
    preset: 'twilight',
    sunAzimuthDeg: 215,
    sunElevationDeg: 24,
    sunIntensity: 1.05,
    sunColor: '#92aef5',
    ambientIntensity: 0.34,
    skyColor: '#4c6591',
    groundColor: '#232633',
    backdropColor: '#29354d',
    fogEnabled: true,
    fogColor: '#2c3952',
    shadowsEnabled: true,
    pointLightsEnabled: true,
    pointLightIntensity: 1.5,
    pointLightRangeScale: 1.1,
    lavaGlowEnabled: true,
  },
  night: {
    preset: 'night',
    sunAzimuthDeg: 38,
    sunElevationDeg: 44,
    sunIntensity: 0.58,
    sunColor: '#7ca2e3',
    ambientIntensity: 0.2,
    skyColor: '#223557',
    groundColor: '#111621',
    backdropColor: '#0e1524',
    fogEnabled: true,
    fogColor: '#121b2e',
    shadowsEnabled: true,
    pointLightsEnabled: true,
    pointLightIntensity: 1.8,
    pointLightRangeScale: 1.2,
    lavaGlowEnabled: true,
  },
  dungeon: {
    preset: 'dungeon',
    sunAzimuthDeg: 315,
    sunElevationDeg: 62,
    sunIntensity: 0.42,
    sunColor: '#8aa0bd',
    ambientIntensity: 0.22,
    skyColor: '#2d3748',
    groundColor: '#171412',
    backdropColor: '#11151d',
    fogEnabled: true,
    fogColor: '#151a24',
    shadowsEnabled: true,
    pointLightsEnabled: true,
    pointLightIntensity: 1.9,
    pointLightRangeScale: 1.25,
    lavaGlowEnabled: true,
  },
};

export const LIGHTING_PRESET_ORDER: readonly Exclude<LightingPresetId, 'custom'>[] = [
  'daylight',
  'golden_hour',
  'twilight',
  'night',
  'dungeon',
];

export const LIGHTING_PRESET_LABELS: Record<LightingPresetId, string> = {
  daylight: 'Daylight',
  golden_hour: 'Golden Hour',
  twilight: 'Twilight',
  night: 'Night',
  dungeon: 'Dungeon',
  custom: 'Custom',
};

export function createDefaultLightingSettings(
  preset: Exclude<LightingPresetId, 'custom'> = 'daylight'
): LightingSettings {
  return { ...LIGHTING_PRESETS[preset] };
}

export function hexStringToNumber(hex: string, fallback = 0xffffff): number {
  const clean = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return fallback;
  return parseInt(clean, 16);
}

/** Classifies whether a placed WorldLab/local asset emits dynamic light. */
export function classifyPropLightSource(entry: WorldLabAssetEntry): PropLightProfile | null {
  const text = `${entry.key} ${entry.name}`.toLowerCase();
  if (/watch_brazier|brazier/.test(text)) {
    return {
      kind: 'brazier',
      color: 0xff7824,
      baseIntensity: 18,
      rangeMeters: 12.0, // ~40 ft bright+dim
      radiusMeters: 0.35,
      heightMeters: 1.75,
      forwardOffsetMeters: 0,
      flickerAmount: 0.18,
    };
  }
  if (/wall_torch/.test(text)) {
    return {
      kind: 'wall_torch',
      color: 0xff8c2e,
      baseIntensity: 13.5,
      rangeMeters: 9.5, // ~30 ft D&D torch
      radiusMeters: 0.25,
      heightMeters: 2.35,
      forwardOffsetMeters: 0.45,
      flickerAmount: 0.15,
    };
  }
  if (/wall_cresset|cresset/.test(text)) {
    return {
      kind: 'cresset',
      color: 0xff8429,
      baseIntensity: 13.0,
      rangeMeters: 9.0,
      radiusMeters: 0.25,
      heightMeters: 2.15,
      forwardOffsetMeters: 0.45,
      flickerAmount: 0.15,
    };
  }
  if (/standing_torch|torch/.test(text)) {
    return {
      kind: 'torch',
      color: 0xff8a2b,
      baseIntensity: 14.0,
      rangeMeters: 9.5,
      radiusMeters: 0.25,
      heightMeters: 2.15,
      forwardOffsetMeters: 0,
      flickerAmount: 0.15,
    };
  }
  if (/lantern|lamp|campfire|hearth|fireplace/.test(text)) {
    return {
      kind: 'lantern',
      color: 0xffa64a,
      baseIntensity: 12.0,
      rangeMeters: 8.5,
      radiusMeters: 0.25,
      heightMeters: 1.45,
      forwardOffsetMeters: 0,
      flickerAmount: 0.1,
    };
  }
  return null;
}

/**
 * Finds Magma/Lava overlay tiles (id === 118) and clusters them into well-spaced
 * PointLight emitters so lava channels & fire pits glow warmly without wasting lights.
 */
export function extractLavaLightClusters(grid: TerrainGrid, maxClusters = 10): LavaLightCluster[] {
  const lavaTiles: { tx: number; tz: number; h: number }[] = [];
  for (let tz = 0; tz < grid.length; tz++) {
    for (let tx = 0; tx < grid.width; tx++) {
      if (grid.getTile(tx, tz).overlayId !== 118) continue;
      const h =
        (grid.getHeight(tx, tz) +
          grid.getHeight(tx + 1, tz) +
          grid.getHeight(tx, tz + 1) +
          grid.getHeight(tx + 1, tz + 1)) *
        0.25;
      lavaTiles.push({ tx, tz, h });
    }
  }
  if (lavaTiles.length === 0) return [];

  // Greedy spatial clustering within 3.6 tiles so each lava pool/channel gets 1-2 smooth lights
  const clusters: { sumX: number; sumZ: number; sumH: number; count: number }[] = [];
  const mergeRadius = 3.6;

  for (const tile of lavaTiles) {
    let best: (typeof clusters)[number] | null = null;
    let bestDist = mergeRadius;
    for (const c of clusters) {
      const cx = c.sumX / c.count;
      const cz = c.sumZ / c.count;
      const d = Math.hypot(tile.tx + 0.5 - cx, tile.tz + 0.5 - cz);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    if (best) {
      best.sumX += tile.tx + 0.5;
      best.sumZ += tile.tz + 0.5;
      best.sumH += tile.h;
      best.count++;
    } else {
      clusters.push({ sumX: tile.tx + 0.5, sumZ: tile.tz + 0.5, sumH: tile.h, count: 1 });
    }
  }

  clusters.sort((a, b) => b.count - a.count);
  return clusters.slice(0, maxClusters).map((c) => ({
    tileX: c.sumX / c.count,
    tileZ: c.sumZ / c.count,
    heightUnits: c.sumH / c.count,
    tileCount: c.count,
  }));
}

/**
 * Computes an approximate unlit RGB tint hex for Flat RS2 / Gouraud RS2 fallback modes
 * so switching to Dusk/Night/Dungeon visibly adapts unlit RS2 terrain too.
 */
export function computeUnlitMoodTintHex(settings: LightingSettings): number {
  const sunHex = hexStringToNumber(settings.sunColor, 0xffffff);
  const skyHex = hexStringToNumber(settings.skyColor, 0xc6ddf5);
  const sr = ((sunHex >> 16) & 0xff) / 255;
  const sg = ((sunHex >> 8) & 0xff) / 255;
  const sb = (sunHex & 0xff) / 255;
  const ar = ((skyHex >> 16) & 0xff) / 255;
  const ag = ((skyHex >> 8) & 0xff) / 255;
  const ab = (skyHex & 0xff) / 255;

  const sunW = Math.min(1, settings.sunIntensity / 2.55);
  const ambW = Math.min(1, settings.ambientIntensity / 0.72);
  const energy = Math.max(0.24, Math.min(1.15, sunW * 0.68 + ambW * 0.36));

  const r = Math.min(1, (sr * sunW * 0.72 + ar * ambW * 0.38) / Math.max(0.25, sunW * 0.72 + ambW * 0.38)) * energy;
  const g = Math.min(1, (sg * sunW * 0.72 + ag * ambW * 0.38) / Math.max(0.25, sunW * 0.72 + ambW * 0.38)) * energy;
  const b = Math.min(1, (sb * sunW * 0.72 + ab * ambW * 0.38) / Math.max(0.25, sunW * 0.72 + ambW * 0.38)) * energy;

  const ir = Math.max(0, Math.min(255, Math.round(r * 255)));
  const ig = Math.max(0, Math.min(255, Math.round(g * 255)));
  const ib = Math.max(0, Math.min(255, Math.round(b * 255)));
  return (ir << 16) | (ig << 8) | ib;
}

const MAX_ACTIVE_POINT_LIGHTS = 28;

export interface LightingSceneHost {
  readonly sun: SceneManager['sun'];
  readonly skybox: Pick<SceneManager['skybox'], 'applyLightingSettings'>;
  setEnvironmentAndAtmosphere: SceneManager['setEnvironmentAndAtmosphere'];
  fitSunShadows: SceneManager['fitSunShadows'];
}

export class LightingManager {
  private readonly scene: LightingSceneHost;
  private readonly lightsRoot: Container3D;
  private readonly managedLights: ManagedPointLight[] = [];

  settings: LightingSettings = createDefaultLightingSettings('daylight');
  private mapWidth = 32;
  private mapLength = 32;
  private elapsedSeconds = 0;

  private activePropLightCount = 0;
  private activeLavaLightCount = 0;

  onMoodTintChange?: (tintHex: number) => void;

  constructor(scene: LightingSceneHost, lightsRoot: Container3D) {
    this.scene = scene;
    this.lightsRoot = lightsRoot;
  }

  get propLightCount(): number {
    return this.activePropLightCount;
  }

  get lavaLightCount(): number {
    return this.activeLavaLightCount;
  }

  get totalLightCount(): number {
    return this.managedLights.length;
  }

  setMapBounds(width: number, length: number): void {
    this.mapWidth = width;
    this.mapLength = length;
    this.applyEnvironmentAndSun();
  }

  applyPreset(preset: Exclude<LightingPresetId, 'custom'>): void {
    this.settings = createDefaultLightingSettings(preset);
    this.applyEnvironmentAndSun();
    this.applyPointLightScalars();
  }

  loadSettings(next: Partial<LightingSettings> | undefined): void {
    const base =
      next?.preset && next.preset !== 'custom' && next.preset in LIGHTING_PRESETS
        ? createDefaultLightingSettings(next.preset)
        : createDefaultLightingSettings('daylight');
    this.settings = {
      ...base,
      ...(next ?? {}),
    };
    this.applyEnvironmentAndSun();
    this.applyPointLightScalars();
  }

  patchSettings(patch: Partial<LightingSettings>): void {
    this.settings = {
      ...this.settings,
      ...patch,
      preset: patch.preset ?? 'custom',
    };
    this.applyEnvironmentAndSun();
    this.applyPointLightScalars();
  }

  /** Pushes current DirectionalLight, Hemisphere environment, Fog, and sky background to SceneManager. */
  applyEnvironmentAndSun(): void {
    const s = this.settings;
    const worldW = this.mapWidth * TILE_SIZE_METERS;
    const worldL = this.mapLength * TILE_SIZE_METERS;
    const maxSpan = Math.max(worldW, worldL);
    const cx = worldW * 0.5;
    const cz = worldL * 0.5;

    const azRad = (s.sunAzimuthDeg * Math.PI) / 180;
    const elRad = (Math.max(5, Math.min(88, s.sunElevationDeg)) * Math.PI) / 180;
    const dist = Math.max(42, maxSpan * 1.15);
    const cosEl = Math.cos(elRad);

    this.scene.sun.position.set(
      cx + Math.sin(azRad) * cosEl * dist,
      Math.sin(elRad) * dist,
      cz + Math.cos(azRad) * cosEl * dist
    );
    this.scene.sun.lookAt({ x: cx, y: 0, z: cz });
    this.scene.sun.color = hexStringToNumber(s.sunColor, 0xfff5e4);
    this.scene.sun.intensity = s.sunIntensity;
    this.scene.sun.castShadow = s.shadowsEnabled && s.sunIntensity > 0.05;

    // Update Hemisphere environment & sky backdrop
    const skyHex = hexStringToNumber(s.skyColor, 0xc6ddf5);
    const groundHex = hexStringToNumber(s.groundColor, 0x5c5243);
    const backdropHex = hexStringToNumber(s.backdropColor, 0x8ea9c4);

    this.scene.setEnvironmentAndAtmosphere({
      skyColor: skyHex,
      groundColor: groundHex,
      ambientIntensity: s.ambientIntensity,
      backdropColor: backdropHex,
      fogEnabled: s.fogEnabled,
      fogColor: hexStringToNumber(s.fogColor, backdropHex),
      fogNear: Math.max(48, maxSpan * 1.05),
      fogFar: Math.max(150, maxSpan * 3.1),
    });

    this.scene.skybox.applyLightingSettings(s);

    if (this.scene.sun.castShadow) {
      this.scene.fitSunShadows();
    }

    this.onMoodTintChange?.(computeUnlitMoodTintHex(s));
  }

  /** Rebuilds dynamic PointLight emitters from placed light props and lava terrain tiles on the active layer. */
  syncLightSources(grid: TerrainGrid, placedAssets: readonly PlacedAsset[], layerOffsetY = 0): void {
    for (const m of this.managedLights) {
      this.lightsRoot.removeChild(m.light);
      m.light.destroy();
    }
    this.managedLights.length = 0;
    this.activePropLightCount = 0;
    this.activeLavaLightCount = 0;

    // 1. Add dynamic PointLights for every light-emitting placed prop (torches, wall torches, braziers, cressets)
    for (const p of placedAssets) {
      if (this.managedLights.length >= MAX_ACTIVE_POINT_LIGHTS) break;
      const profile = classifyPropLightSource(p.entry);
      if (!profile) continue;

      const avgScale = (p.scaleX + p.scaleY + p.scaleZ) / 3;
      const groundY = grid.sampleHeightAtTileCoord(p.tileX, p.tileZ) * METERS_PER_HEIGHT_UNIT + layerOffsetY;
      const extraY = p.yOffsetFeet * (TILE_SIZE_METERS / 5);
      const yaw = (p.rotationDegrees * Math.PI) / 180;

      // For wall decorations, push the light slightly outward along local +Z so it illuminates
      // the wall face cleanly instead of sitting buried inside the wall masonry!
      const fwd = isWallDecorEntry(p.entry) ? profile.forwardOffsetMeters : 0;
      const wx = p.tileX * TILE_SIZE_METERS + Math.sin(yaw) * fwd;
      const wz = p.tileZ * TILE_SIZE_METERS + Math.cos(yaw) * fwd;
      const wy = groundY + extraY + profile.heightMeters * Math.max(0.5, p.scaleY);

      const light = new PointLight({
        color: profile.color,
        intensity: profile.baseIntensity * avgScale,
        range: profile.rangeMeters * Math.max(0.7, avgScale),
        radius: profile.radiusMeters,
        label: `light_${p.id}`,
      });
      light.position.set(wx, wy, wz);
      this.lightsRoot.addChild(light);

      this.managedLights.push({
        light,
        baseIntensity: profile.baseIntensity * avgScale,
        baseRange: profile.rangeMeters * Math.max(0.7, avgScale),
        flickerAmount: profile.flickerAmount,
        phase: stablePhase(p.id, profile.kind),
        sourceKind: 'prop',
      });
      this.activePropLightCount++;
    }

    // 2. Add warm glowing PointLights for Magma / Lava terrain clusters
    const remainingBudget = Math.max(0, MAX_ACTIVE_POINT_LIGHTS - this.managedLights.length);
    if (remainingBudget > 0) {
      const clusters = extractLavaLightClusters(grid, Math.min(10, remainingBudget));
      for (let i = 0; i < clusters.length; i++) {
        const c = clusters[i]!;
        const sizeBoost = Math.min(1.6, 0.85 + Math.sqrt(c.tileCount) * 0.25);
        const baseIntensity = 13.0 * sizeBoost;
        const baseRange = 8.5 * Math.min(1.45, 0.9 + Math.sqrt(c.tileCount) * 0.16);

        const light = new PointLight({
          color: 0xff4b14,
          intensity: baseIntensity,
          range: baseRange,
          radius: 0.65,
          label: `lava_light_${i}`,
        });
        light.position.set(
          c.tileX * TILE_SIZE_METERS,
          c.heightUnits * METERS_PER_HEIGHT_UNIT + layerOffsetY + 1.35,
          c.tileZ * TILE_SIZE_METERS
        );
        this.lightsRoot.addChild(light);

        this.managedLights.push({
          light,
          baseIntensity,
          baseRange,
          flickerAmount: 0.1,
          phase: stablePhase(`lava_${i}`, `${c.tileX.toFixed(1)}_${c.tileZ.toFixed(1)}`),
          sourceKind: 'lava',
        });
        this.activeLavaLightCount++;
      }
    }

    this.applyPointLightScalars();
  }

  private applyPointLightScalars(): void {
    const s = this.settings;
    for (const m of this.managedLights) {
      const enabled = m.sourceKind === 'lava' ? s.lavaGlowEnabled && s.pointLightsEnabled : s.pointLightsEnabled;
      m.light.visible = enabled;
      m.light.intensity = enabled ? m.baseIntensity * s.pointLightIntensity : 0;
      m.light.range = m.baseRange * s.pointLightRangeScale;
    }
  }

  /** Animates subtle organic fire flicker on all active prop & lava PointLights. */
  tick(dtSeconds: number, animate: boolean): void {
    if (!animate) return;
    this.elapsedSeconds += Math.min(0.05, dtSeconds);
    const s = this.settings;
    if (!s.pointLightsEnabled) return;

    for (const m of this.managedLights) {
      if (!m.light.visible) continue;
      const t = this.elapsedSeconds * 5.0 + m.phase * Math.PI * 2;
      const wave = Math.sin(t) * 0.65 + Math.sin(t * 2.3 + 0.9) * 0.35;
      m.light.intensity = m.baseIntensity * s.pointLightIntensity * (1 + wave * m.flickerAmount);
    }
  }

  destroy(): void {
    for (const m of this.managedLights) {
      this.lightsRoot.removeChild(m.light);
      m.light.destroy();
    }
    this.managedLights.length = 0;
    this.activePropLightCount = 0;
    this.activeLavaLightCount = 0;
    this.onMoodTintChange = undefined;
  }
}
