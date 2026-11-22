import type { Rng } from './dice';
import type { D20Rule, RollMode, SourceLabel } from './types';

/**
 * Teste d20 autoritativo (docs/effects-spec.md, "Rolagem d20"): rola com o RNG
 * injetado, aplica as regras `d20_rule` na ordem do contrato e registra cada
 * passo, para o log do chat e o override do mestre.
 */

const D20 = 20;
const NATURAL_20 = 20;

export interface D20RollInput {
  /** Modificador total da ficha (já com a Exaustão). */
  modifier: number;
  mode: RollMode;
  /** Regras que valem nesta rolagem (as certas da ficha, mais as situacionais que o contexto confirmou). */
  rules?: readonly (D20Rule & { source?: SourceLabel | undefined })[] | undefined;
  /** Menor d20 que é crítico (`critRange` do ataque); 20 por padrão. */
  critMin?: number | undefined;
  /** CD da salvaguarda ou do teste; sem ela, `success` fica ausente. */
  dc?: number | undefined;
}

export type D20Step =
  | { kind: 'roll'; values: number[] }
  | { kind: 'reroll'; index: number; from: number; to: number; source?: SourceLabel | undefined }
  | { kind: 'keep'; value: number; mode: RollMode }
  | { kind: 'count_as_20'; value: number; source?: SourceLabel | undefined }
  | { kind: 'minimum_die'; from: number; to: number; source?: SourceLabel | undefined }
  | { kind: 'modifier'; value: number; total: number }
  | { kind: 'minimum_total'; from: number; to: number; source?: SourceLabel | undefined }
  | { kind: 'auto_success'; source?: SourceLabel | undefined };

export interface D20RollResult {
  /** Valores finais de cada d20 rolado (depois de `reroll`). */
  dice: number[];
  /** O d20 mantido, antes de `minimum_die`: decide crítico e falha crítica. */
  natural: number;
  /** O d20 que entra no total (depois de `minimum_die`). */
  die: number;
  total: number;
  /** 20 natural, `count_as_20` ou `critMin`. */
  critical: boolean;
  /** 1 natural. */
  fumble: boolean;
  /** Só com `dc`. */
  success?: boolean | undefined;
  steps: D20Step[];
}

type WithSource<R extends D20Rule['rule']> = Extract<D20Rule, { rule: R }> & { source?: SourceLabel | undefined };

/** A regra mais forte de cada tipo (não se acumulam): maior mínimo, menor `count_as_20`. */
function strongest<R extends D20Rule['rule']>(
  rules: readonly (D20Rule & { source?: SourceLabel | undefined })[],
  rule: R,
  better: (a: WithSource<R>, b: WithSource<R>) => boolean,
): WithSource<R> | undefined {
  let best: WithSource<R> | undefined;
  for (const r of rules) {
    if (r.rule !== rule) continue;
    const candidate = r as WithSource<R>;
    if (!best || better(candidate, best)) best = candidate;
  }
  return best;
}

export function rollD20(input: D20RollInput, rng: Rng): D20RollResult {
  const rules = input.rules ?? [];
  const steps: D20Step[] = [];

  // 1. Um d20, ou dois com Vantagem/Desvantagem.
  const dice = Array.from({ length: input.mode === 'normal' ? 1 : 2 }, () => rng.roll(D20));
  steps.push({ kind: 'roll', values: [...dice] });

  // 2. `reroll`: cada dado que mostrou `on` é rolado de novo uma vez (vale o novo valor).
  dice.forEach((value, index) => {
    const rule = rules.find((r): r is WithSource<'reroll'> => r.rule === 'reroll' && r.on === value);
    if (!rule) return;
    const to = rng.roll(D20);
    dice[index] = to;
    steps.push({ kind: 'reroll', index, from: value, to, source: rule.source });
  });

  // 3. Mantém o maior (Vantagem) ou o menor (Desvantagem): o natural.
  const natural = input.mode === 'advantage' ? Math.max(...dice) : input.mode === 'disadvantage' ? Math.min(...dice) : (dice[0] ?? 1);
  if (dice.length > 1) steps.push({ kind: 'keep', value: natural, mode: input.mode });
  const countAs20 = strongest(rules, 'count_as_20', (a, b) => a.min < b.min);
  const critMin = Math.min(input.critMin ?? NATURAL_20, countAs20?.min ?? NATURAL_20);
  const critical = natural >= critMin;
  if (countAs20 && natural >= countAs20.min && natural < NATURAL_20) steps.push({ kind: 'count_as_20', value: natural, source: countAs20.source });

  // 4. `minimum_die` sobre o dado mantido.
  let die = natural;
  const minimumDie = strongest(rules, 'minimum_die', (a, b) => a.value > b.value);
  if (minimumDie && die < minimumDie.value) {
    steps.push({ kind: 'minimum_die', from: die, to: minimumDie.value, source: minimumDie.source });
    die = minimumDie.value;
  }

  // 5. Modificador; 6. `minimum_total`.
  let total = die + input.modifier;
  steps.push({ kind: 'modifier', value: input.modifier, total });
  const minimumTotal = strongest(rules, 'minimum_total', (a, b) => a.value > b.value);
  if (minimumTotal && total < minimumTotal.value) {
    steps.push({ kind: 'minimum_total', from: total, to: minimumTotal.value, source: minimumTotal.source });
    total = minimumTotal.value;
  }

  // 7. Contra a CD: `auto_success` vence qualquer resultado.
  let success: boolean | undefined;
  if (input.dc !== undefined) {
    const auto = rules.find((r) => r.rule === 'auto_success');
    if (auto) steps.push({ kind: 'auto_success', source: auto.source });
    success = auto !== undefined || total >= input.dc;
  }

  return { dice, natural, die, total, critical, fumble: natural === 1, success, steps };
}
