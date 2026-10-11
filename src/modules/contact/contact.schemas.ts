import { ContactSchema } from '@bosskantaponguttarawichien-boop/wang-raan-core';

/** `ContactMessageRequest` ในสัญญา = ContactSchema ของ core โดยไม่มี honeypot (BFF ตรวจแล้ว) */
export const ContactMessageRequestSchema = ContactSchema.omit({ website: true });

export const CONTACT_RATE_LIMITS = { ip: 5, user: 5, global: 50 } as const;

export interface ContactMessageAccepted {
  id: string;
  receivedAt: string;
}
