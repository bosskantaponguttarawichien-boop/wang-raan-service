import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';

describe('loadConfig', () => {
  it('requires a sufficiently long INTERNAL_TOKEN_SECRET', () => {
    expect(() => loadConfig({})).toThrow(/INTERNAL_TOKEN_SECRET/);
    expect(() => loadConfig({ INTERNAL_TOKEN_SECRET: 'short' })).toThrow(/at least 32/);
  });

  it('parses a valid environment with default log level and package version', () => {
    expect(loadConfig({ INTERNAL_TOKEN_SECRET: 'x'.repeat(32) })).toEqual({
      internalTokenSecret: 'x'.repeat(32),
      logLevel: 'info',
      version: '0.1.0',
      contactWebhookUrl: null,
      production: false,
      mail: null,
      otpTestCode: null,
    });
  });

  it('configures Resend only with MAIL_FROM and never allows OTP_TEST_CODE in production', () => {
    const base = { INTERNAL_TOKEN_SECRET: 'x'.repeat(32) };

    expect(loadConfig({ ...base, RESEND_API_KEY: 're_1', MAIL_FROM: 'วางร้าน <no-reply@example.com>' }).mail).toEqual({
      resendApiKey: 're_1',
      from: 'วางร้าน <no-reply@example.com>',
    });
    expect(() => loadConfig({ ...base, RESEND_API_KEY: 're_1' })).toThrow(/MAIL_FROM/);
    expect(loadConfig({ ...base, OTP_TEST_CODE: '123456' }).otpTestCode).toBe('123456');
    expect(() => loadConfig({ ...base, OTP_TEST_CODE: '12345' })).toThrow(/OTP_TEST_CODE/);
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', OTP_TEST_CODE: '123456' })).toThrow(/production/);
    expect(loadConfig({ ...base, NODE_ENV: 'production' })).toMatchObject({ production: true, mail: null });
  });

  it('prefers APP_VERSION set at deploy time', () => {
    expect(loadConfig({ INTERNAL_TOKEN_SECRET: 'x'.repeat(32), APP_VERSION: ' 2026.10.11-abc123 ' }).version).toBe(
      '2026.10.11-abc123',
    );
  });

  it('treats empty optional variables as unset and validates the webhook URL', () => {
    const base = { INTERNAL_TOKEN_SECRET: 'x'.repeat(32) };

    expect(loadConfig({ ...base, CONTACT_WEBHOOK_URL: '', APP_VERSION: '' })).toMatchObject({
      contactWebhookUrl: null,
      version: '0.1.0',
    });
    expect(loadConfig({ ...base, CONTACT_WEBHOOK_URL: 'https://hooks.example/x' }).contactWebhookUrl).toBe(
      'https://hooks.example/x',
    );
    expect(() => loadConfig({ ...base, CONTACT_WEBHOOK_URL: 'not a url' })).toThrow(/CONTACT_WEBHOOK_URL/);
  });
});
