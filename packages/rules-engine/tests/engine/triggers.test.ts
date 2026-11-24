import { describe, expect, it } from 'vitest';
import { isBloodied } from '../../src/engine/hit-points';
import type { DerivedSheet } from '../../src/engine/types';
import { EffectSchema } from '../../src/schemas/effect';
import { loadSrdCompendium } from '../../src/srd';
import { derive } from './helpers';

/** Lembretes e cura de turno (docs/effects-spec.md 3.21 e 3.22, nota 0043). */

const adjustment = (name: string, effects: unknown[]) => ({ id: name.toLowerCase().normalize('NFD').replace(/[^a-z]/g, ''), name, effects });
/** Os gatilhos com só o nome da fonte. */
const named = (triggers: DerivedSheet['triggers']) => triggers.map((t) => ({ ...t, source: t.source.name }));
const poisoned = { active: [{ condition: 'poisoned' as const }], exhaustion: 0 };

describe('reminder and turn_start_heal effects', () => {
  it('requires the reminder text and a known moment', () => {
    expect(EffectSchema.safeParse({ type: 'reminder', on: 'initiative', note: 'Lembrete' }).success).toBe(true);
    expect(EffectSchema.safeParse({ type: 'reminder', on: 'initiative' }).success).toBe(false);
    expect(EffectSchema.safeParse({ type: 'reminder', on: 'round_start', note: 'Lembrete' }).success).toBe(false);
    expect(EffectSchema.safeParse({ type: 'turn_start_heal', value: 5, ability: 'con', bloodiedOnly: true }).success).toBe(true);
    expect(EffectSchema.safeParse({ type: 'turn_start_heal', value: 5 }).success).toBe(false);
  });

  it('lists the reminders of the sheet with their moment and source', () => {
    const sheet = derive({
      adjustments: [adjustment('Bênção', [{ type: 'reminder', on: 'initiative', note: 'Recupera um uso.' }, { type: 'reminder', on: 'turn_end', note: 'Fim.' }])],
    });
    expect(named(sheet.triggers)).toEqual([
      { kind: 'reminder', on: 'initiative', text: 'Recupera um uso.', source: 'Bênção' },
      { kind: 'reminder', on: 'turn_end', text: 'Fim.', source: 'Bênção' },
    ]);
    expect(derive({}).triggers).toEqual([]);
  });

  it('adds the ability modifier to the healing, never below 0', () => {
    // Guerreiro anão: CON 14 + 1 (Soldier) = 15, +2; INT 8, −1.
    const sheet = derive({
      adjustments: [
        adjustment('Rally', [{ type: 'turn_start_heal', value: 5, ability: 'con', bloodiedOnly: true }]),
        adjustment('Fraco', [{ type: 'turn_start_heal', value: 0, ability: 'int', bloodiedOnly: false }]),
      ],
    });
    expect(named(sheet.triggers)).toEqual([
      { kind: 'heal', on: 'turn_start', amount: 7, bloodiedOnly: true, source: 'Rally' },
      { kind: 'heal', on: 'turn_start', amount: 0, bloodiedOnly: false, source: 'Fraco' },
    ]);
  });

  it('evaluates `when` with the conditions of the creature; roll predicates leave the reminder out', () => {
    const effects = [
      { type: 'reminder', on: 'turn_end', note: 'Pode encerrar Envenenado.', when: { hasCondition: 'poisoned' } },
      { type: 'reminder', on: 'turn_start', note: 'Só num ataque.', when: { attackKind: 'melee' } },
    ];
    expect(derive({ adjustments: [adjustment('x', effects)] }).triggers).toEqual([]);
    expect(derive({ adjustments: [adjustment('x', effects)], conditions: poisoned }).triggers.map((t) => t.kind === 'reminder' && t.text)).toEqual([
      'Pode encerrar Envenenado.',
    ]);
  });
});

describe('Bloodied (SRD 5.2.1 Rules Glossary)', () => {
  it('is at half the hit points or fewer', () => {
    expect(isBloodied(20, { damage: 9, temp: 0 })).toBe(false);
    expect(isBloodied(20, { damage: 10, temp: 0 })).toBe(true);
    expect(isBloodied(21, { damage: 10, temp: 0 })).toBe(false);
    expect(isBloodied(21, { damage: 11, temp: 0 })).toBe(true);
    // PV temporários não contam: Sangrando é sobre os PV.
    expect(isBloodied(20, { damage: 15, temp: 10 })).toBe(true);
  });
});

describe('SRD curation (Phase 5, turn and initiative reminders)', () => {
  const srd = loadSrdCompendium();
  /** As características do compêndio por id, com os efeitos. */
  const features = new Map<string, { effects?: unknown[] }>();
  const walk = (o: unknown): void => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object') {
      const rec = o as Record<string, unknown>;
      if (rec['kind'] === 'feature' && rec['feature'] && typeof rec['feature'] === 'object') {
        const feature = rec['feature'] as { id: string; effects?: unknown[] };
        features.set(feature.id, feature);
      }
      Object.values(rec).forEach(walk);
    }
  };
  walk([srd.classes, srd.subclasses, srd.feats]);
  // Só os momentos dos lembretes e curas (a característica pode ter outros efeitos, como `resource`).
  const moments = (id: string) =>
    (features.get(id)?.effects ?? []).filter((e) => (e as { type: string }).type !== 'resource').map((e) => (e as { type: string; on?: string }).on ?? (e as { type: string }).type);

  it.each([
    ['persistent_rage', 'initiative'],
    ['superior_inspiration', 'initiative'],
    ['archdruid', 'initiative'],
    ['uncanny_metabolism', 'initiative'],
    ['perfect_focus', 'initiative'],
    ['thiefs_reflexes', 'initiative'],
    ['initiative_swap', 'initiative'],
    ['heroic_warrior', 'turn_start'],
    ['self_restoration', 'turn_end'],
  ])('%s reminds at %s', (id, on) => {
    expect(moments(id)).toEqual([on]);
  });

  it('Heroic Rally heals 5 + CON while Bloodied; Self-Restoration only with one of its conditions', () => {
    expect(features.get('survivor')?.effects).toContainEqual({ type: 'turn_start_heal', value: 5, ability: 'con', bloodiedOnly: true });
    expect(features.get('self_restoration')?.effects).toEqual([
      expect.objectContaining({ when: { any: [{ hasCondition: 'charmed' }, { hasCondition: 'frightened' }, { hasCondition: 'poisoned' }] } }),
    ]);
    expect(features.get('initiative_swap')?.effects).toEqual([expect.objectContaining({ when: { not: { hasCondition: 'incapacitated' } } })]);
  });
});
