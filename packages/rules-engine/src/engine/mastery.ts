import type { DamageType, Size, WeaponMastery } from '../schemas/common';
import { DAMAGE_NAME } from './names';

/**
 * Maestrias de arma (SRD 5.2.1, "Mastery Properties"). Depois de um ataque
 * com uma arma cuja maestria o personagem domina, o motor diz o que a
 * maestria permite:
 * - `cleave`, `graze` e `topple` têm uma **ação de seguimento** que o Host
 *   resolve quando o atacante a usa (segundo ataque, dano no erro,
 *   salvaguarda contra Caído);
 * - `push`, `sap`, `slow`, `vex` e `nick` dependem de posição ou de turnos
 *   (Fase 5) e ficam como lembrete.
 */

/** As maestrias que o atacante pode usar com um clique depois do ataque. */
export const MASTERY_ACTIONS = ['cleave', 'graze', 'topple'] as const;
export type MasteryAction = (typeof MASTERY_ACTIONS)[number];

export const MASTERY_NAME: Record<WeaponMastery, string> = {
  cleave: 'Cleave',
  graze: 'Graze',
  nick: 'Nick',
  push: 'Push',
  sap: 'Sap',
  slow: 'Slow',
  topple: 'Topple',
  vex: 'Vex',
};

/** Tamanhos que o Push consegue empurrar (Grande ou menor). */
const PUSHABLE: readonly Size[] = ['tiny', 'small', 'medium', 'large'];

/** Base da CD do Topple: 8 + modificador do ataque + proficiência. */
export const TOPPLE_DC_BASE = 8;

export interface MasteryContext {
  property: WeaponMastery;
  hit: boolean;
  /** O acerto causou dano maior que 0 (Slow e Vex pedem dano). */
  damaged: boolean;
  /** Modificador do atributo usado no ataque. */
  abilityModifier: number;
  proficiencyBonus: number;
  damageType: DamageType;
  /** Tamanho do alvo (Push só empurra Grande ou menor). */
  targetSize: Size;
  /** Este ataque já é o segundo ataque do Cleave (não oferece outro: 1 vez por turno). */
  fromCleave?: boolean | undefined;
}

export interface MasteryOutcome {
  property: WeaponMastery;
  /** Ação de seguimento disponível; ausente quando a maestria é só lembrete ou não se aplica. */
  action?: MasteryAction | undefined;
  /** O que a maestria faz agora, em pt-BR. */
  notes: string[];
}

/** CD da salvaguarda de Constituição do Topple. */
export function toppleDc(abilityModifier: number, proficiencyBonus: number): number {
  return TOPPLE_DC_BASE + abilityModifier + proficiencyBonus;
}

/** Dano do Graze no erro: o modificador do atributo do ataque (nada se não for positivo). */
export function grazeDamage(abilityModifier: number): number {
  return Math.max(0, abilityModifier);
}

/** Bônus de dano do segundo ataque do Cleave: sem o modificador do atributo, a menos que seja negativo. */
export function cleaveDamageBonus(bonus: number, abilityModifier: number): number {
  return bonus - Math.max(0, abilityModifier);
}

/** O que a maestria permite depois deste ataque. */
export function masteryOutcome(ctx: MasteryContext): MasteryOutcome {
  const name = MASTERY_NAME[ctx.property];
  const out = (notes: string[], action?: MasteryAction): MasteryOutcome => ({ property: ctx.property, ...(action ? { action } : {}), notes });
  switch (ctx.property) {
    case 'cleave':
      if (!ctx.hit) return out([]);
      if (ctx.fromCleave) return out([]);
      return out(
        [`${name}: pode atacar outra criatura a até 5 ft do alvo e ao seu alcance; sem o modificador de atributo no dano (1 vez por turno)`],
        'cleave',
      );
    case 'graze': {
      if (ctx.hit) return out([]);
      const amount = grazeDamage(ctx.abilityModifier);
      if (amount === 0) return out([`${name}: sem dano no erro (modificador de atributo não é positivo)`]);
      return out([`${name}: pode causar ${amount} de dano ${DAMAGE_NAME[ctx.damageType]} mesmo errando`], 'graze');
    }
    case 'topple':
      if (!ctx.hit) return out([]);
      return out(
        [`${name}: pode forçar uma salvaguarda de Constituição CD ${toppleDc(ctx.abilityModifier, ctx.proficiencyBonus)}; na falha, o alvo fica Caído`],
        'topple',
      );
    case 'push':
      if (!ctx.hit) return out([]);
      return out([
        PUSHABLE.includes(ctx.targetSize)
          ? `${name}: pode empurrar o alvo até 10 ft para longe de você em linha reta (mova o token)`
          : `${name}: o alvo é grande demais para ser empurrado (só Grande ou menor)`,
      ]);
    case 'sap':
      if (!ctx.hit) return out([]);
      return out([`${name}: o alvo tem Desvantagem na próxima jogada de ataque antes do início do seu próximo turno`]);
    case 'slow':
      if (!ctx.hit || !ctx.damaged) return out([]);
      return out([`${name}: pode reduzir o deslocamento do alvo em 10 ft até o início do seu próximo turno (não acumula)`]);
    case 'vex':
      if (!ctx.hit || !ctx.damaged) return out([]);
      return out([`${name}: você tem Vantagem na próxima jogada de ataque contra este alvo antes do fim do seu próximo turno`]);
    case 'nick':
      return out([`${name}: o ataque extra da propriedade Leve pode ser parte da ação de Ataque, em vez de Ação Bônus (1 vez por turno)`]);
  }
}
