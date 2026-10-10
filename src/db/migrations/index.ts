import { initialSchemaMigration } from './001-initial-schema.js';
import type { Migration } from './types.js';

export const migrations: readonly Migration[] = [initialSchemaMigration];
export type { Migration } from './types.js';
