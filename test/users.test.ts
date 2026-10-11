import { describe, expect, it } from 'vitest';
import { nextFreeId } from '../src/modules/users/users.service.js';

describe('nextFreeId', () => {
  it('appends -guest-copy and counts up on further collisions', () => {
    expect(nextFreeId('cafe', new Set(['cafe']))).toBe('cafe-guest-copy');
    expect(nextFreeId('cafe', new Set(['cafe', 'cafe-guest-copy', 'cafe-guest-copy-2']))).toBe('cafe-guest-copy-3');
  });

  it('never exceeds the 128-character id limit', () => {
    const long = 'x'.repeat(128);
    const id = nextFreeId(long, new Set([long]));

    expect(id).toHaveLength(128);
    expect(id.endsWith('-guest-copy')).toBe(true);
  });
});
