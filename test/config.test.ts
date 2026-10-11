import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';

describe('loadConfig', () => {
  it('requires a sufficiently long INTERNAL_TOKEN_SECRET', () => {
    expect(() => loadConfig({})).toThrow(/INTERNAL_TOKEN_SECRET/);
    expect(() => loadConfig({ INTERNAL_TOKEN_SECRET: 'short' })).toThrow(/at least 32/);
  });

  it('parses a valid environment with default log level', () => {
    expect(loadConfig({ INTERNAL_TOKEN_SECRET: 'x'.repeat(32) })).toEqual({
      internalTokenSecret: 'x'.repeat(32),
      logLevel: 'info',
    });
  });
});
