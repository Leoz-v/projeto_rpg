import { describe, expect, it } from 'vitest';
import type { Grant } from '../../src/schemas/source';
import { loadSrdCompendium } from '../../src/srd';
import backlog from './automation-backlog.json';

/**
 * Guarda da Fase 1.5 (nota 0015): tudo o que o compêndio tem sem efeito declarado está
 * classificado no backlog, e o backlog só lista o que ainda não tem efeito. Ao automatizar algo,
 * a entrada sai do backlog; ao entrar conteúdo novo sem efeito, ele precisa ser classificado.
 */

type Entry = { category: string; reason: string; mechanics?: string[] };
const entries = backlog.entries as Record<string, Entry>;
const CATEGORIES = new Set(['structural', 'automate', 'phase_4', 'phase_5', 'phase_7', 'gm', 'none']);
const snake = (name: string): string => name.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const srd = loadSrdCompendium();

/** Características com efeitos (base das entradas parciais). */
const featuresWithEffects = new Set<string>();

/** Características sem efeito, com o nível da fonte em que aparecem e se o nível tem outras concessões. */
function featuresWithoutEffects(): Map<string, boolean> {
  const out = new Map<string, boolean>();
  const visit = (grants: readonly Grant[], src: string): void => {
    const others = grants.some((g) => g.kind !== 'feature');
    for (const g of grants) {
      if (g.kind === 'feature' && g.feature.effects.length > 0) featuresWithEffects.add(`feature:${src}/${g.feature.id}`);
      if (g.kind === 'feature' && g.feature.effects.length === 0) {
        const key = `feature:${src}/${g.feature.id}`;
        out.set(key, (out.get(key) ?? false) || others);
      }
      if (g.kind === 'choice' && g.options.pick === 'option') {
        for (const o of g.options.options) {
          visit(o.grants, src);
          for (const l of o.levels) visit(l.grants, src);
        }
      }
    }
  };
  const sources: [string, { id: string; levels?: { grants: Grant[] }[]; grants?: Grant[] }[]][] = [
    ['species', srd.species],
    ['background', srd.backgrounds],
    ['feat', srd.feats],
    ['class', srd.classes],
    ['subclass', srd.subclasses],
  ];
  for (const [kind, list] of sources) {
    for (const e of list) {
      if (e.grants) visit(e.grants, `${kind}:${e.id}`);
      for (const l of e.levels ?? []) visit(l.grants, `${kind}:${e.id}`);
    }
  }
  return out;
}

const features = featuresWithoutEffects();
const magic = srd.items.filter((i) => i.kind === 'magic_item');
const itemKeys = new Set(
  magic.filter((i) => i.effects.length === 0 && !i.use && !i.casting && i.variants.every((v) => v.effects.length === 0 && !v.use && !v.scroll)).map((i) => `item:${i.id}`),
);
const variantKeys = new Set(magic.flatMap((i) => i.variants.filter((v) => v.effects.length === 0 && !v.use && !v.scroll).map((v) => `item:${i.id}/${v.id}`)));
const traitKeys = new Set(
  srd.creatures.flatMap((c) => c.traits.filter((t) => t.effects.length === 0).map((t) => `monster_trait:${snake(t.name.split(' (')[0] ?? t.name)}`)),
);
const traitsWithEffects = new Set(
  srd.creatures.flatMap((c) => c.traits.filter((t) => t.effects.length > 0).map((t) => `monster_trait:${snake(t.name.split(' (')[0] ?? t.name)}`)),
);
const actionKeys = new Set(
  srd.creatures.flatMap((c) => c.actions.filter((a) => a.kind === 'text').map((a) => `monster_action:${snake(a.name.split(' (')[0] ?? a.name)}`)),
);

/** Magias sem resolução estruturada (nota 0054) e as que já têm. */
const spellKeys = new Set(srd.spells.filter((s) => s.resolution.length === 0).map((s) => `spell:${s.id}`));
const structuredSpells = new Set(srd.spells.filter((s) => s.resolution.length > 0).map((s) => `spell:${s.id}`));

describe('automation backlog (Fase 1.5)', () => {
  it('classifies every feature, magic item, monster trait, text action and spell without effects', () => {
    const required = [...features.keys(), ...itemKeys, ...traitKeys, ...actionKeys, ...spellKeys];
    expect(required.length).toBeGreaterThan(500);
    expect(required.filter((k) => !(k in entries))).toEqual([]);
  });

  it('lists only things that still lack effects (automated entries leave the backlog)', () => {
    const known = new Set([...features.keys(), ...itemKeys, ...variantKeys, ...traitKeys, ...actionKeys, ...spellKeys]);
    // Entradas parciais (`<chave>#<aspecto>`): a fonte já tem efeitos e guarda uma parte pendente.
    const isPartial = (k: string): boolean => {
      const base = k.split('#')[0] ?? k;
      return (
        k.includes('#') &&
        (magic.some((i) => `item:${i.id}` === base) || featuresWithEffects.has(base) || traitsWithEffects.has(base) || structuredSpells.has(base))
      );
    };
    expect(Object.keys(entries).filter((k) => !known.has(k) && !isPartial(k))).toEqual([]);
  });

  it('uses known categories, and a known mechanic for every automate entry', () => {
    const mechanics = new Set(Object.keys(backlog.mechanics));
    for (const [key, e] of Object.entries(entries)) {
      expect(CATEGORIES.has(e.category), key).toBe(true);
      expect(e.reason.length, key).toBeGreaterThan(10);
      if (e.category === 'automate') {
        expect(e.mechanics?.length, key).toBeGreaterThan(0);
        for (const m of e.mechanics ?? []) expect(mechanics.has(m), `${key}: ${m}`).toBe(true);
      } else expect(e.mechanics, key).toBeUndefined();
    }
  });

  it('backs every structural feature with another grant at the same level', () => {
    const unbacked = Object.entries(entries)
      .filter(([key, e]) => e.category === 'structural' && key.startsWith('feature:') && !features.get(key))
      .map(([key]) => key);
    expect(unbacked).toEqual([]);
  });
});
