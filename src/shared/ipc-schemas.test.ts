import { describe, expect, it } from 'vitest';
import { AppInfoSchema } from './ipc-schemas';

describe('AppInfoSchema', () => {
  it('accepts a valid payload', () => {
    expect(
      AppInfoSchema.safeParse({ appVersion: '0.1.0', protocolVersion: 1, rulesEngineVersion: '0.1.0' })
        .success,
    ).toBe(true);
  });

  it('rejects a non-integer protocol version', () => {
    expect(
      AppInfoSchema.safeParse({ appVersion: '0.1.0', protocolVersion: 1.5, rulesEngineVersion: '0.1.0' })
        .success,
    ).toBe(false);
  });
});
