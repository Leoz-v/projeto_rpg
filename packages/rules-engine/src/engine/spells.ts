import type { Effect } from '../schemas/effect';
import type { DamageType } from '../schemas/common';
import type { Spell, SpellPart } from '../schemas/spell';

type PartOf<K extends SpellPart['kind']> = Extract<SpellPart, { kind: K }>;

/**
 * Resolução das magias (notas 0054 e 0056): a parte estruturada da magia
 * (`resolution`) vira dados concretos para um conjurador e um espaço. O
 * motor só calcula a expressão; quem rola, contra quais alvos e com qual
 * bônus de ataque ou CD é a mesa (Fase 7, PR 2).
 *
 * SRD 5.2.1:
 * - "Using a Higher-Level Spell Slot": os dados por círculo acima do da magia;
 * - "Cantrip Upgrade": nos níveis 5, 11 e 17 do personagem, o truque rola
 *   mais dados (ou cria mais raios, no Eldritch Blast).
 */

/** Patamar do truque pelo nível do personagem: 1 (níveis 1–4), 2 (5–10), 3 (11–16), 4 (17+). */
export function cantripTier(characterLevel: number): 1 | 2 | 3 | 4 {
  if (characterLevel >= 17) return 4;
  if (characterLevel >= 11) return 3;
  if (characterLevel >= 5) return 2;
  return 1;
}

// --- Expressões de dados -------------------------------------------------------

interface Terms {
  /** Quantidade de dados por número de faces, na ordem em que aparecem. */
  dice: Map<number, number>;
  flat: number;
}

function parseTerms(expression: string): Terms {
  const terms: Terms = { dice: new Map(), flat: 0 };
  for (const match of expression.matchAll(/([+-]?)(\d+)(?:d(\d+))?/g)) {
    const sign = match[1] === '-' ? -1 : 1;
    const value = sign * Number(match[2]);
    if (match[3] === undefined) terms.flat += value;
    else terms.dice.set(Number(match[3]), (terms.dice.get(Number(match[3])) ?? 0) + value);
  }
  return terms;
}

function formatTerms(terms: Terms): string {
  const parts: string[] = [];
  for (const [sides, count] of terms.dice) {
    if (count !== 0) parts.push(`${count < 0 ? '-' : parts.length > 0 ? '+' : ''}${Math.abs(count)}d${sides}`);
  }
  if (terms.flat !== 0 || parts.length === 0) parts.push(`${terms.flat < 0 ? '-' : parts.length > 0 ? '+' : ''}${Math.abs(terms.flat)}`);
  return parts.join('');
}

/** Soma `extra` a `base` `times` vezes, juntando dados iguais: `8d6` + 2 × `1d6` = `10d6`. */
export function addDice(base: string, extra: string, times = 1): string {
  const terms = parseTerms(base);
  const more = parseTerms(extra);
  for (const [sides, count] of more.dice) terms.dice.set(sides, (terms.dice.get(sides) ?? 0) + count * times);
  terms.flat += more.flat * times;
  return formatTerms(terms);
}

/** Multiplica só os dados (não os números fixos): `1d10` × 3 = `3d10`. */
export function multiplyDice(expression: string, factor: number): string {
  const terms = parseTerms(expression);
  for (const [sides, count] of terms.dice) terms.dice.set(sides, count * factor);
  return formatTerms(terms);
}

/** Soma um número fixo (o modificador de conjuração): `1d8` + 3 = `1d8+3`, `1d8` − 1 = `1d8-1`. */
export function addFlat(expression: string, value: number): string {
  const terms = parseTerms(expression);
  terms.flat += value;
  return formatTerms(terms);
}

// --- Partes da magia -------------------------------------------------------------

export interface SpellCastOptions {
  /** Círculo do espaço gasto; ausente, o da magia. Truques ignoram. */
  slotLevel?: number | undefined;
  /** Nível total do personagem (melhoria dos truques). */
  characterLevel: number;
  /** Modificador do atributo de conjuração de quem conjura. */
  modifier: number;
}

export interface ResolvedSpellDamage {
  dice: string;
  /** Um tipo, ou os tipos entre os quais quem conjura escolhe. */
  type: DamageType | DamageType[];
}

export interface ResolvedSpellOption {
  label: string;
  effects: Effect[];
}

/**
 * Uma parte da magia com os dados e a quantidade já calculados para quem
 * conjura. Ataque e dano direto: `count` ataques ou projéteis (1 sem
 * `count`). Salvaguarda, cura e condição: `count` é o máximo de alvos, e sem
 * ele não há limite. A cura vem como expressão de dados ou `full`.
 */
export type ResolvedSpellPart =
  | (Omit<PartOf<'attack'>, 'damage' | 'count'> & { damage: ResolvedSpellDamage[]; count: number })
  | (Omit<PartOf<'damage'>, 'damage' | 'count'> & { damage: ResolvedSpellDamage[]; count: number })
  | (Omit<PartOf<'save'>, 'damage' | 'count' | 'options'> & { options: ResolvedSpellOption[]; damage: ResolvedSpellDamage[]; count?: number | undefined })
  | (Omit<PartOf<'heal'>, 'healing' | 'count'> & { /** Expressão de dados, ou `full` (todos os PV). */ healing: string; count?: number | undefined })
  | (Omit<PartOf<'condition'>, 'count'> & { count?: number | undefined })
  | (Omit<PartOf<'buff'>, 'count' | 'upcast' | 'variants' | 'options'> & { options: ResolvedSpellOption[]; count?: number | undefined });

export function resolveSpellParts(spell: Spell, options: SpellCastOptions): ResolvedSpellPart[] {
  const above = spell.level === 0 ? 0 : Math.max(0, (options.slotLevel ?? spell.level) - spell.level);
  const tier = spell.level === 0 ? cantripTier(options.characterLevel) : 1;
  const amount = (d: { dice: string; perSlot?: string | undefined; addModifier?: true | undefined }): string => {
    let dice = d.perSlot ? addDice(d.dice, d.perSlot, above) : d.dice;
    if (spell.cantripUpgrade === 'damage') dice = multiplyDice(dice, tier);
    return d.addModifier ? addFlat(dice, options.modifier) : dice;
  };
  const total = (count: SpellPart['count']): number => {
    const base = (count?.base ?? 1) + (count?.perSlot ?? 0) * above;
    return spell.cantripUpgrade === 'count' ? base * tier : base;
  };
  const repeated = (effects: readonly Effect[]): Effect[] => Array.from({ length: above }, () => effects).flat();
  const resolvedOptions = (list: PartOf<'buff'>['options']): ResolvedSpellOption[] => list.map((o) => ({ label: o.label, effects: [...o.effects, ...repeated(o.upcast)] }));
  const slot = Math.max(spell.level, options.slotLevel ?? spell.level);
  return spell.resolution.map((part): ResolvedSpellPart => {
    switch (part.kind) {
      case 'attack':
      case 'damage': {
        const { damage, count, ...rest } = part;
        return { ...rest, damage: damage.map((d) => ({ dice: amount(d), type: d.type })), count: total(count) };
      }
      case 'save': {
        const { damage, count, options: choices, ...rest } = part;
        return { ...rest, options: resolvedOptions(choices), damage: damage.map((d) => ({ dice: amount(d), type: d.type })), ...(count ? { count: total(count) } : {}) };
      }
      case 'heal': {
        const { healing, count, ...rest } = part;
        return { ...rest, healing: healing === 'full' ? 'full' : amount(healing), ...(count ? { count: total(count) } : {}) };
      }
      case 'condition': {
        const { count, ...rest } = part;
        return { ...rest, ...(count ? { count: total(count) } : {}) };
      }
      case 'buff': {
        // Aid: +5 PV, e +5 por círculo acima (os `flat_bonus` do mesmo alvo se somam).
        const { count, upcast, effects, options: choices, variants, ...rest } = part;
        const variant = variants.findLast((v) => (v.slot === undefined || slot >= v.slot) && (v.level === undefined || options.characterLevel >= v.level));
        return { ...rest, effects: [...(variant?.effects ?? effects), ...repeated(upcast)], options: resolvedOptions(choices), ...(count ? { count: total(count) } : {}) };
      }
    }
  });
}

/**
 * Os danos de uma parte com o tipo já decidido: quem conjura escolhe entre os
 * tipos da lista (Chromatic Orb). `undefined` se a parte pede a escolha e ela
 * falta ou não está na lista; uma escolha numa parte sem lista é ignorada.
 */
export function spellDamageWith(damage: readonly ResolvedSpellDamage[], chosen: DamageType | undefined): { dice: string; type: DamageType }[] | undefined {
  const result: { dice: string; type: DamageType }[] = [];
  for (const d of damage) {
    if (typeof d.type === 'string') result.push({ dice: d.dice, type: d.type });
    else if (chosen !== undefined && d.type.includes(chosen)) result.push({ dice: d.dice, type: chosen });
    else return undefined;
  }
  return result;
}
