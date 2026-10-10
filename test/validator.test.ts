import { describe, expect, it } from 'vitest';
import type { StoreLayout } from '@bosskantaponguttarawichien-boop/wang-raan-core';
import { parseAndValidateLayout } from '../src/services/validator.js';

const layout: StoreLayout = {
  id: 'test-layout',
  version: 1,
  units: 'm',
  width: 4,
  depth: 4,
  entrance: null,
  objects: [],
};

describe('layout validator', () => {
  it('parses a core StoreLayout and returns the core validation result', () => {
    const result = parseAndValidateLayout({ layout });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.layout).toEqual(layout);
      expect(result.validation.status).toBe('blocked');
      expect(result.validation.issues.some((issue) => issue.severity === 'blocked')).toBe(true);
    }
  });

  it('rejects a layout that violates the shared Zod schema', () => {
    const result = parseAndValidateLayout({
      layout: {
        ...layout,
        units: 'cm',
      },
    });

    expect(result).toMatchObject({ success: false });
  });

  it('rejects duplicate object ids that OpenAPI alone cannot express', () => {
    const result = parseAndValidateLayout({
      layout: {
        ...layout,
        objects: [
          { id: 'counter', type: 'counter', x: 0, y: 0, width: 1, depth: 1, rotation: 0 },
          { id: 'counter', type: 'counter', x: 2, y: 0, width: 1, depth: 1, rotation: 0 },
        ],
      },
    });

    expect(result).toMatchObject({ success: false });
  });
});
