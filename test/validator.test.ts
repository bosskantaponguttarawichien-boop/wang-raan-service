import { describe, expect, it } from 'vitest';
import type { StoreLayout } from '@bosskantaponguttarawichien-boop/wang-raan-core';
import { parseAndValidateLayout } from '../src/services/validator.js';
import { legacyKitchenLayout } from './helpers/layouts.js';

const layout: StoreLayout = {
  id: 'test-layout',
  version: 1,
  units: 'm',
  width: 4,
  depth: 4,
  entrance: null,
  kitchenDoor: null,
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

  it('accepts a core 1.x layout with a floor kitchen and migrates it to a kitchen door', () => {
    const result = parseAndValidateLayout({ layout: legacyKitchenLayout() });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.layout.kitchenDoor).toEqual({ id: 'kitchen-01', wall: 'north', position: 0.5, width: 0.9 });
      expect(result.layout.objects.some((object) => (object.type as string) === 'kitchen')).toBe(false);
      expect(result.validation.status).toBe('ready');
    }
  });

  it('rejects a layout that violates the shared Zod schema', () => {
    const result = parseAndValidateLayout({
      layout: {
        ...layout,
        units: 'cm',
      },
    });

    expect(result).toMatchObject({ success: false, details: [{ path: 'layout.units' }] });
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
