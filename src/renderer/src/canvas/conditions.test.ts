import { describe, expect, it } from 'vitest';
import type { SessionCharacter, Token } from '../../../shared/protocol';
import { makeToken } from '../../../shared/protocol/test-fixtures';
import { conditionLabels, tokenConditions } from './conditions';

const token = (overrides: Partial<Token>): Token => makeToken({ id: 't', mapId: 'm', name: 'Goblin', size: 'small', monsterId: 'goblin', conditions: { active: [{ condition: 'prone' }], exhaustion: 0 }, ...overrides });

describe('token conditions', () => {
  it('uses the character conditions for a character token, and its own otherwise', () => {
    const hero = { conditions: { active: [{ condition: 'poisoned' }], exhaustion: 2 } } as SessionCharacter;
    expect(tokenConditions(token({}), {}).active).toEqual([{ condition: 'prone' }]);
    expect(tokenConditions(token({ characterId: 'h' }), { h: hero })).toEqual(hero.conditions);
    expect(tokenConditions(token({ characterId: 'gone' }), {})).toEqual({ active: [], exhaustion: 0 });
  });

  it('labels the conditions in pt-BR, exhaustion last with its level', () => {
    expect(conditionLabels({ active: [{ condition: 'prone' }, { condition: 'poisoned' }], exhaustion: 3 })).toEqual(['Caído', 'Envenenado', 'Exaustão 3']);
    expect(conditionLabels({ active: [], exhaustion: 0 })).toEqual([]);
  });
});
