import { NO_CONDITIONS } from './common';
import { NO_MONSTER_USES, type Token } from './state';

/**
 * Token padrão dos testes: cada teste informa só o que importa para ele. Um
 * campo novo no `TokenSchema` entra aqui, e não em cada teste. Só para testes.
 */
export function makeToken(overrides: Partial<Token> = {}): Token {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    mapId: '00000000-0000-4000-8000-000000000010',
    name: 'Token',
    position: { x: 0, y: 0 },
    size: 'medium',
    monsterId: null,
    image: null,
    ownerIds: [],
    characterId: null,
    hp: null,
    conditions: NO_CONDITIONS,
    spellEffects: [],
    concentration: null,
    uses: NO_MONSTER_USES,
    visionFeet: null,
    rotation: 0,
    elevation: 0,
    hidden: false,
    dead: false,
    ...overrides,
  };
}
