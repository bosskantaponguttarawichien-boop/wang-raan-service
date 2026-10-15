/**
 * ส่งรหัส OTP ทางอีเมล (สัญญา requestOtp) — ห้าม log รหัสหรืออีเมลเต็ม
 * ตอนนี้รองรับ Resend (HTTP API เดียว); ถ้าเลือก SES ภายหลังให้เพิ่ม implementation ของ `OtpMailer` อีกตัว
 */
export interface OtpMailer {
  sendOtp(email: string, code: string, expiresInSeconds: number): Promise<void>;
}

const MAIL_TIMEOUT_MS = 10_000;

export function otpEmail(code: string, expiresInSeconds: number): { subject: string; text: string } {
  const minutes = Math.round(expiresInSeconds / 60);
  return {
    subject: `รหัสเข้าสู่ระบบวางร้าน: ${code}`,
    text: [
      `รหัสเข้าสู่ระบบวางร้านของคุณคือ ${code}`,
      '',
      `รหัสใช้ได้ ${minutes} นาที และใช้ได้ครั้งเดียว`,
      'ถ้าคุณไม่ได้ขอรหัสนี้ ไม่ต้องทำอะไร — บัญชีของคุณยังปลอดภัย',
    ].join('\n'),
  };
}

export function createResendMailer(apiKey: string, from: string, fetchImpl: typeof fetch = fetch): OtpMailer {
  return {
    async sendOtp(email, code, expiresInSeconds) {
      const { subject, text } = otpEmail(code, expiresInSeconds);
      const response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: [email], subject, text }),
        signal: AbortSignal.timeout(MAIL_TIMEOUT_MS),
      });
      // ห้ามแนบ body ของ response (อาจมีอีเมลผู้รับ) ลงใน error
      if (!response.ok) throw new Error(`mail provider responded ${response.status}`);
    },
  };
}

/** นอก production ที่ยังไม่ตั้งค่าเมล: ไม่ส่งจริง (ใช้คู่กับ OTP_TEST_CODE ตอน E2E) */
export const noopMailer: OtpMailer = {
  async sendOtp() {},
};
