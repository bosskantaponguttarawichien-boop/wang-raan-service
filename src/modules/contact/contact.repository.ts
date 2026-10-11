import type { PoolClient } from 'pg';

export async function insertContactMessage(
  client: PoolClient,
  message: { userId: string | null; name: string; email: string; message: string; clientIp: string },
): Promise<{ id: string; receivedAt: Date }> {
  const result = await client.query<{ id: string; received_at: Date }>(
    `INSERT INTO contact_messages (user_id, name, email, message, client_ip)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, received_at`,
    [message.userId, message.name, message.email, message.message, message.clientIp],
  );
  const row = result.rows[0] as { id: string; received_at: Date };
  return { id: row.id, receivedAt: row.received_at };
}
