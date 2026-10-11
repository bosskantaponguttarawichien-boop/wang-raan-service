import { describe, expect, it } from 'vitest';
import { expiryProblem, shareStatus } from '../src/modules/shares/shares.schemas.js';
import { generateShareKey, isShareKey } from '../src/services/share-generator.js';

const NOW = new Date('2026-10-11T00:00:00.000Z');
const days = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);

describe('share key generator', () => {
  it('produces unique 43-character base64url keys', () => {
    const keys = new Set(Array.from({ length: 1000 }, generateShareKey));

    expect(keys.size).toBe(1000);
    for (const key of keys) expect(isShareKey(key)).toBe(true);
  });
});

describe('share status', () => {
  it('puts revoked before expired', () => {
    expect(shareStatus({ revokedAt: days(-2), expiresAt: days(-1) }, NOW)).toBe('revoked');
    expect(shareStatus({ revokedAt: null, expiresAt: NOW }, NOW)).toBe('expired');
    expect(shareStatus({ revokedAt: null, expiresAt: days(1) }, NOW)).toBe('active');
    expect(shareStatus({ revokedAt: null, expiresAt: null }, NOW)).toBe('active');
  });

  it('requires expiry in the future and within 365 days', () => {
    expect(expiryProblem(null, NOW)).toBeNull();
    expect(expiryProblem(days(365), NOW)).toBeNull();
    expect(expiryProblem(NOW, NOW)).toMatch(/future/);
    expect(expiryProblem(days(365.01), NOW)).toMatch(/365/);
  });
});
