/**
 * Pontos de Vida atuais (SRD 5.2.1 p. 17–18, "Hit Points", "Dropping to 0 Hit
 * Points", "Temporary Hit Points"). O estado guarda o dano sofrido, não os PV
 * atuais: o máximo é derivado (ficha ou bloco de estatísticas) e pode mudar
 * (subir de nível, ajuste do mestre) sem apagar o dano.
 *
 * Sem dependências: a tela (barra de PV no mapa) importa este módulo por
 * `rules-engine/hit-points`, sem trazer o compêndio.
 */

export interface HitPointState {
  /** Dano sofrido: PV atuais = máximo − dano (de 0 ao máximo). */
  damage: number;
  /** PV temporários: absorvem o dano primeiro e não se acumulam. */
  temp: number;
}

export type HitPointChange =
  | { kind: 'damage'; amount: number }
  | { kind: 'healing'; amount: number }
  /** Recebe PV temporários: substitui os atuais (quem recebe escolhe ficar com os antigos ou os novos). */
  | { kind: 'temp'; amount: number };

export interface HitPointResult {
  state: HitPointState;
  /** Dano absorvido pelos PV temporários. */
  absorbed: number;
  /** PV perdidos ou recuperados de fato (a cura além do máximo se perde). */
  hpChange: number;
  /** Caiu a 0 PV com esta mudança. */
  droppedToZero: boolean;
  /** Sofreu dano já estando com 0 PV (falha na Salvaguarda contra a Morte, Fase 5). */
  damagedAtZero: boolean;
  /** Dano massivo: o que sobrou depois de chegar a 0 é maior ou igual ao máximo (morte instantânea de personagem). */
  massiveDamage: boolean;
}

export function currentHitPoints(max: number, state: HitPointState): number {
  return Math.max(0, max - state.damage);
}

/** Normaliza o estado para um máximo novo (o dano não passa do máximo). */
export function clampHitPoints(max: number, state: HitPointState): HitPointState {
  return { damage: Math.min(Math.max(0, state.damage), Math.max(0, max)), temp: Math.max(0, state.temp) };
}

export function applyHitPointChange(max: number, before: HitPointState, change: HitPointChange): HitPointResult {
  const state = clampHitPoints(max, before);
  const current = currentHitPoints(max, state);
  const amount = Math.max(0, Math.trunc(change.amount));
  const none = { absorbed: 0, hpChange: 0, droppedToZero: false, damagedAtZero: false, massiveDamage: false };

  switch (change.kind) {
    case 'temp':
      return { ...none, state: { ...state, temp: amount } };
    case 'healing': {
      const healed = Math.min(amount, state.damage);
      return { ...none, state: { ...state, damage: state.damage - healed }, hpChange: healed };
    }
    case 'damage': {
      const absorbed = Math.min(amount, state.temp);
      const remaining = amount - absorbed;
      const lost = Math.min(remaining, current);
      const leftover = remaining - lost;
      return {
        state: { damage: state.damage + lost, temp: state.temp - absorbed },
        absorbed,
        hpChange: lost === 0 ? 0 : -lost,
        droppedToZero: current > 0 && current - lost === 0,
        damagedAtZero: current === 0 && remaining > 0,
        massiveDamage: remaining > 0 && current - lost === 0 && leftover >= max,
      };
    }
  }
}
