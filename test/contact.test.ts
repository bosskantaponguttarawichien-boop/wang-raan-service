import { describe, expect, it, vi } from 'vitest';
import { createWebhookNotifier, formatContactNotification } from '../src/services/notifier.js';
import { secondsUntilWindowEnds, windowStart } from '../src/services/rate-limiter.js';

const notification = {
  id: '0b8c0c9e-1d7a-4a43-9c55-6e2f0c1b2a3d',
  name: 'Somchai',
  email: 'somchai@example.com',
  message: 'อยากสอบถามเรื่องการจัดร้าน',
  receivedAt: '2026-10-11T08:00:00.000Z',
};

describe('fixed window', () => {
  it('aligns windows to 10-minute boundaries', () => {
    expect(windowStart(new Date('2026-10-11T08:17:42.500Z')).toISOString()).toBe('2026-10-11T08:10:00.000Z');
    expect(windowStart(new Date('2026-10-11T08:20:00.000Z')).toISOString()).toBe('2026-10-11T08:20:00.000Z');
  });

  it('reports at least one second until the window ends', () => {
    expect(secondsUntilWindowEnds(new Date('2026-10-11T08:10:00.000Z'))).toBe(600);
    expect(secondsUntilWindowEnds(new Date('2026-10-11T08:19:59.900Z'))).toBe(1);
  });
});

describe('webhook notifier', () => {
  it('posts a Slack/Discord compatible payload', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    await createWebhookNotifier('https://hooks.example/abc', fetchImpl).notifyContactMessage(notification);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const payload = JSON.parse(init.body as string);
    expect(url).toBe('https://hooks.example/abc');
    expect(payload.text).toBe(payload.content);
    expect(payload.text).toContain('somchai@example.com');
  });

  it('fails loudly on non-2xx so the caller can log it', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }));

    await expect(
      createWebhookNotifier('https://hooks.example/abc', fetchImpl).notifyContactMessage(notification),
    ).rejects.toThrow(/HTTP 500/);
  });

  it('keeps messages within Discord’s 2000-character limit', () => {
    expect(formatContactNotification({ ...notification, message: 'ก'.repeat(2000) }).length).toBeLessThanOrEqual(1900);
  });
});
