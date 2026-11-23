import { currentHitPoints } from 'rules-engine/hit-points';
import type { SessionState, Token } from '../../../shared/protocol';

/** PV que a barra do token mostra. */
export interface Health {
  current: number;
  max: number;
  temp: number;
}

/**
 * PV de um token: os do personagem ligado (máximo da ficha, `maxima`) ou os
 * do próprio token. `null` quando não se sabe (token de jogador sem PV, monstro
 * escondido deste jogador, personagem ainda sem ficha).
 */
export function tokenHealth(token: Token, characters: SessionState['characters'], maxima: Readonly<Record<string, number>>): Health | null {
  if (token.characterId !== null) {
    const character = characters[token.characterId];
    const max = maxima[token.characterId];
    if (!character || max === undefined) return null;
    return { current: currentHitPoints(max, character.hp), max, temp: character.hp.temp };
  }
  if (!token.hp) return null;
  return { current: currentHitPoints(token.hp.max, token.hp), max: token.hp.max, temp: token.hp.temp };
}

/** Cor da barra: verde acima da metade, amarela até um quarto, vermelha abaixo (0 PV: cinza). */
export function healthColor(health: Health): number {
  if (health.current === 0) return 0x6b6878;
  const ratio = health.current / health.max;
  return ratio > 0.5 ? 0x5fd38d : ratio > 0.25 ? 0xffd166 : 0xff7a7a;
}
