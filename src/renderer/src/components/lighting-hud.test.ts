import { describe, expect, it } from 'vitest';
import { DEFAULT_VISION_PROFILE, SRD_LIGHT_GEAR_PRESETS, SRD_LIGHT_SPELL_PRESETS } from 'rules-engine/vision';
import { buildLightInputFromPreset, formatVisionSummary, snapWallCoord } from './lighting-hud-helpers';

describe('lighting-hud-helpers', () => {
  it('snaps wall coordinates to 0.5-cell increments clamped to map bounds', () => {
    expect(snapWallCoord(2.24, 10)).toBe(2);
    expect(snapWallCoord(2.26, 10)).toBe(2.5);
    expect(snapWallCoord(-1.3, 10)).toBe(0);
    expect(snapWallCoord(12.4, 10)).toBe(10);
  });

  it('builds runtime light inputs from SRD gear and spell presets with optional concentration link', () => {
    const torch = SRD_LIGHT_GEAR_PRESETS.find((p) => p.id === 'torch');
    if (!torch) throw new Error('Expected torch preset');
    const builtTorch = buildLightInputFromPreset(torch, { kind: 'token', tokenId: '00000000-0000-4000-8000-000000000011' });
    expect(builtTorch.kind).toBe('light');
    expect(builtTorch.brightFeet).toBe(20);
    expect(builtTorch.dimFeet).toBe(20);
    expect(builtTorch.flicker).toBe(true);
    expect(builtTorch.spell).toBeUndefined();

    const darkness = SRD_LIGHT_SPELL_PRESETS.find((p) => p.id === 'darkness');
    if (!darkness) throw new Error('Expected darkness preset');
    const builtDark = buildLightInputFromPreset(
      darkness,
      { kind: 'point', x: 5, y: 5 },
      { characterId: '00000000-0000-4000-8000-000000000022', spellId: 'darkness' },
    );
    expect(builtDark.kind).toBe('darkness');
    expect(builtDark.darknessFeet).toBe(15);
    expect(builtDark.spellLevel).toBe(2);
    expect(builtDark.spell).toEqual({
      characterId: '00000000-0000-4000-8000-000000000022',
      spellId: 'darkness',
    });
  });

  it('formats derived VisionProfile into pt-BR summaries', () => {
    expect(formatVisionSummary(DEFAULT_VISION_PROFILE)).toEqual(['Visão normal: ilimitada (na luz)']);
    expect(
      formatVisionSummary({
        normalRangeFeet: 30,
        darkvisionFeet: 60,
        magicalDarknessVisionFeet: 120,
        blindsightFeet: 10,
        tremorsenseFeet: 15,
        truesightFeet: 60,
        blinded: false,
      }),
    ).toEqual([
      'Visão normal: 30 ft',
      'Visão no Escuro: 60 ft (P&B na escuridão)',
      'Escuridão mágica: 120 ft',
      'Percepção às Cegas: 10 ft',
      'Sentido Sísmico: 15 ft',
      'Visão Verdadeira: 60 ft',
    ]);
    expect(
      formatVisionSummary({
        ...DEFAULT_VISION_PROFILE,
        blinded: true,
        blindsightFeet: 10,
      }),
    ).toEqual(['Cego (sentidos visuais desativados)', 'Percepção às Cegas: 10 ft']);
  });
});
