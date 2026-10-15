import { initialSchemaMigration } from './001-initial-schema.js';
import { identitiesMigration } from './002-identities.js';
import { layoutNamesOtpMigration } from './003-layout-names-otp.js';
import type { Migration } from './types.js';

export const migrations: readonly Migration[] = [initialSchemaMigration, identitiesMigration, layoutNamesOtpMigration];
export type { Migration } from './types.js';
