import { describe, expect, it } from 'vitest';
import { RULES_ENGINE_VERSION } from '../src/index';

describe('rules-engine', () => {
  it('exposes a semver version', () => {
    expect(RULES_ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
