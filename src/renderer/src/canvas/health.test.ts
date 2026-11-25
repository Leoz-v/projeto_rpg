import { describe, expect, it } from 'vitest';
import type { SessionState, Token } from '../../../shared/protocol';
import { healthColor, tokenHealth } from './health';

const token = (overrides: Partial<Token>): Token => ({
  id: 't',
  mapId: 'm',
  name: 'Goblin',
  position: { x: 0, y: 0 },
  size: 'small',
  monsterId: 'goblin',
  image: null,
  ownerIds: [],
  characterId: null,
  hp: null,
  conditions: { active: [], exhaustion: 0 },
  visionFeet: null, spellEffects: [], uses: { spent: {}, lair: false }, concentration: null,
  rotation: 0,
  elevation: 0,
  ...overrides,
});

describe('token health', () => {
  const characters = {
    hero: { hp: { damage: 4, temp: 3 } },
  } as unknown as SessionState['characters'];

  it('uses the token hit points or the linked character with the sheet maximum', () => {
    expect(tokenHealth(token({ hp: { max: 7, damage: 2, temp: 0 } }), characters, {})).toEqual({ current: 5, max: 7, temp: 0 });
    expect(tokenHealth(token({ characterId: 'hero' }), characters, { hero: 12 })).toEqual({ current: 8, max: 12, temp: 3 });
    expect(tokenHealth(token({ characterId: 'hero' }), characters, {})).toBeNull();
    expect(tokenHealth(token({}), characters, {})).toBeNull();
  });

  it('colors the bar by how hurt the creature is', () => {
    expect(healthColor({ current: 7, max: 7, temp: 0 })).toBe(0x5fd38d);
    expect(healthColor({ current: 3, max: 7, temp: 0 })).toBe(0xffd166);
    expect(healthColor({ current: 1, max: 7, temp: 0 })).toBe(0xff7a7a);
    expect(healthColor({ current: 0, max: 7, temp: 0 })).toBe(0x6b6878);
  });
});
