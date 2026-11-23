import { describe, expect, it } from 'vitest';
import { nextTokenName } from './token-name';

describe('nextTokenName', () => {
  it('numbers tokens of the same monster after the highest number on the map', () => {
    expect(nextTokenName('Goblin Boss', [])).toBe('Goblin Boss 1');
    expect(nextTokenName('Goblin Boss', ['Goblin Boss 1', 'Goblin Boss 3', 'Ana'])).toBe('Goblin Boss 4');
  });

  it('does not confuse similar names or special characters', () => {
    expect(nextTokenName('Goblin', ['Goblin Boss 2', 'Hobgoblin 5'])).toBe('Goblin 1');
    expect(nextTokenName('Ogre (Zumbi)', ['Ogre (Zumbi) 1'])).toBe('Ogre (Zumbi) 2');
  });
});
