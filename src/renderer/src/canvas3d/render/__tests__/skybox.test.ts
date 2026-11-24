import { describe, expect, it } from 'vitest';
import { createDefaultLightingSettings, LIGHTING_PRESET_ORDER } from '../lightingSystem';
import {
  computeCelestialDirection,
  resolveSkyboxPalette,
  SKYBOX_PRESETS,
  stylizedSkyboxBit,
} from '../skybox';

describe('StylizedSkybox', () => {
  it('provides distinct stylized palettes for every lighting preset', () => {
    for (const preset of LIGHTING_PRESET_ORDER) {
      const settings = createDefaultLightingSettings(preset);
      const palette = resolveSkyboxPalette(settings);
      expect(palette).toBe(SKYBOX_PRESETS[preset]);
      expect(palette.zenithColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(palette.horizonColor).toMatch(/^#[0-9a-f]{6}$/i);
    }

    // Night & Twilight show cratered moon + stars; Daylight shows sun without stars; Dungeon hides celestial body
    expect(SKYBOX_PRESETS.night.moonFactor).toBe(1);
    expect(SKYBOX_PRESETS.night.starVisibility).toBe(1);
    expect(SKYBOX_PRESETS.night.craterStrength).toBeGreaterThan(0);

    expect(SKYBOX_PRESETS.twilight.moonFactor).toBe(1);
    expect(SKYBOX_PRESETS.twilight.starVisibility).toBeGreaterThan(0.5);

    expect(SKYBOX_PRESETS.daylight.moonFactor).toBe(0);
    expect(SKYBOX_PRESETS.daylight.starVisibility).toBe(0);

    expect(SKYBOX_PRESETS.golden_hour.moonFactor).toBe(0);
    expect(SKYBOX_PRESETS.golden_hour.horizonGlowStrength).toBeGreaterThan(1);

    expect(SKYBOX_PRESETS.dungeon.moonFactor).toBe(-1);
    expect(SKYBOX_PRESETS.dungeon.starVisibility).toBe(0);
    expect(SKYBOX_PRESETS.dungeon.celestialRadius).toBe(0);
  });

  it('derives cohesive night and day palettes for custom lighting settings', () => {
    const customNight = resolveSkyboxPalette({
      ...createDefaultLightingSettings('night'),
      preset: 'custom',
      skyColor: '#101c38',
      sunIntensity: 0.4,
    });
    expect(customNight.moonFactor).toBe(1);
    expect(customNight.starVisibility).toBeGreaterThan(0.2);

    const customDay = resolveSkyboxPalette({
      ...createDefaultLightingSettings('daylight'),
      preset: 'custom',
      skyColor: '#b8d8f8',
      sunIntensity: 2.4,
      sunElevationDeg: 50,
    });
    expect(customDay.moonFactor).toBe(0);
    expect(customDay.starVisibility).toBe(0);
  });

  it('computes a normalized celestial direction vector from azimuth and elevation', () => {
    const [x, y, z] = computeCelestialDirection(38, 44);
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
    expect(y).toBeGreaterThan(0.6);
  });

  it('defines matching WebGL and WebGPU shader sources on stylizedSkyboxBit', () => {
    expect(stylizedSkyboxBit.gl?.header).toContain('skyCloudFbm');
    expect(stylizedSkyboxBit.gl?.header).toContain('skyStars');
    expect(stylizedSkyboxBit.gpu?.header).toContain('skyCloudFbm');
    expect(stylizedSkyboxBit.gpu?.header).toContain('skyStars');
  });
});
