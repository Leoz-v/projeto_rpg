import { describe, expect, it } from 'vitest';
import { buildEffect, DEFAULT_FORM, describeEffect } from './effect-forms';

describe('effect forms', () => {
  it('builds catalog effects from the guided fields', () => {
    expect(buildEffect({ ...DEFAULT_FORM, kind: 'bonus', target: 'save.all', value: 1 })).toEqual({ ok: true, effect: { type: 'flat_bonus', target: 'save.all', value: 1 } });
    expect(buildEffect({ ...DEFAULT_FORM, kind: 'immunity_condition', condition: 'charmed' })).toEqual({ ok: true, effect: { type: 'immunity', condition: 'charmed' } });
    expect(buildEffect({ ...DEFAULT_FORM, kind: 'proficiency_skill', skill: 'stealth', expertise: true })).toEqual({
      ok: true,
      effect: { type: 'grant_proficiency', category: 'skill', id: 'stealth', level: 'expertise' },
    });
    expect(buildEffect({ ...DEFAULT_FORM, kind: 'condition', condition: 'exhaustion', exhaustion: 2 })).toEqual({ ok: true, effect: { type: 'condition', condition: 'exhaustion', level: 2 } });
  });

  it('rejects what is not in the catalog', () => {
    expect(buildEffect({ ...DEFAULT_FORM, kind: 'extra_damage', dice: '1d7' }).ok).toBe(false);
    expect(buildEffect({ ...DEFAULT_FORM, kind: 'json', json: '{ "type": "fly_forever" }' }).ok).toBe(false);
    expect(buildEffect({ ...DEFAULT_FORM, kind: 'json', json: 'não é json' })).toEqual({ ok: false, message: 'JSON inválido' });
    expect(buildEffect({ ...DEFAULT_FORM, kind: 'json', json: '{ "type": "crit_range", "min": 19 }' })).toEqual({ ok: true, effect: { type: 'crit_range', min: 19 } });
  });

  it('describes effects in pt-BR', () => {
    expect(describeEffect({ type: 'flat_bonus', target: 'ac', value: 2 })).toBe('+2 em CA');
    expect(describeEffect({ type: 'disadvantage', target: 'save.wis' })).toBe('Desvantagem em Salvaguarda de Sabedoria');
    expect(describeEffect({ type: 'resistance', damageType: 'necrotic' })).toBe('Resistência a Necrótico');
    expect(describeEffect({ type: 'crit_range', min: 19 })).toBe('Crit range: {"type":"crit_range","min":19}');
  });
});
