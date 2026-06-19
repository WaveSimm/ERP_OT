import amqplib, { type Channel } from "amqplib";

const EXCHANGE_NAME = "erp.activity";

// 보안 일괄패치 PDCA Layer 3 (H2): 로그인 실패 등 인증 전 이벤트 시 userId=null 허용
export interface ActivityEvent {
  action: string;
  userId: string | null;
  entityType: string;
  entityId: string;
  description: string;
  metadata?: Record<string, unknown>;
}

let connection: Awaited<ReturnType<typeof amqplib.connect>> | null = null;
let channel: Channel | null = null;
let connecting = false;

async function ensureChannel(): Promise<Channel | null> {
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
    // TODO: inject logger — startup phase에서는 fastify logger 미접근. pino standalone 고려.
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
    // TODO: inject logger — channel은 ensureChannel 후 불안정 상태 가능. logger 주입 시 제거.
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
