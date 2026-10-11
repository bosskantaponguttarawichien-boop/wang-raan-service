export interface ContactNotification {
  id: string;
  name: string;
  email: string;
  message: string;
  receivedAt: string;
}

export interface Notifier {
  notifyContactMessage(notification: ContactNotification): Promise<void>;
}

const WEBHOOK_TIMEOUT_MS = 5000;
// Discord จำกัด content 2000 ตัวอักษร — เผื่อหัวข้อความไว้
const MAX_TEXT_LENGTH = 1900;

export function formatContactNotification(notification: ContactNotification): string {
  const text = [
    `📮 ข้อความใหม่จากฟอร์มติดต่อ วางร้าน (${notification.receivedAt})`,
    `ชื่อ: ${notification.name}`,
    `อีเมล: ${notification.email}`,
    `id: ${notification.id}`,
    '',
    notification.message,
  ].join('\n');
  return text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH - 1)}…` : text;
}

/**
 * ส่งไป incoming webhook — payload มีทั้ง `text` (Slack) และ `content` (Discord)
 * แต่ละบริการอ่านฟิลด์ของตัวเองและไม่สนใจอีกฟิลด์
 */
export function createWebhookNotifier(url: string, fetchImpl: typeof fetch = fetch): Notifier {
  return {
    async notifyContactMessage(notification) {
      const text = formatContactNotification(notification);
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, content: text }),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`contact webhook responded with HTTP ${response.status}`);
    },
  };
}

/** ใช้เมื่อยังไม่ได้ตั้ง CONTACT_WEBHOOK_URL — ข้อความยังอยู่ใน DB ให้ทีมงานดึงดูได้ */
export const noopNotifier: Notifier = {
  async notifyContactMessage() {},
};
