import amqplib from "amqplib";

const EXCHANGE_NAME = "erp.activity";

export interface ActivityEvent {
  action: string;
  userId: string;
  entityType: string;
  entityId: string;
  description: string;
  metadata?: Record<string, unknown>;
}

let connection: any = null;
let channel: any = null;
let connecting = false;

async function ensureChannel(): Promise<any> {
  if (channel) return channel;
  if (connecting) return null;

  const url = process.env.RABBITMQ_URL;
  if (!url) return null;

  connecting = true;
  try {
    connection = await amqplib.connect(url);
    channel = await connection.createChannel();
    await channel.assertExchange(EXCHANGE_NAME, "fanout", { durable: true });

    connection.on("error", () => { channel = null; connection = null; });
    connection.on("close", () => { channel = null; connection = null; });

    return channel;
  } catch (err) {
    console.error("[event-publisher] RabbitMQ connection failed:", (err as Error).message);
    return null;
  } finally {
    connecting = false;
  }
}

export async function publishActivity(event: ActivityEvent): Promise<void> {
  const ch = await ensureChannel();
  if (!ch) return; // silent fail — logging is best-effort

  try {
    ch.publish(
      EXCHANGE_NAME,
      "",
      Buffer.from(JSON.stringify({ ...event, timestamp: new Date().toISOString() })),
      { persistent: true },
    );
  } catch (err) {
    console.error("[event-publisher] publish failed:", (err as Error).message);
    channel = null;
  }
}

export async function closePublisher(): Promise<void> {
  try {
    if (channel) await channel.close();
    if (connection) await connection.close();
  } catch { /* ignore */ }
  channel = null;
  connection = null;
}
