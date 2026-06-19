import amqplib, { type Channel, type ConsumeMessage } from "amqplib";
import { PrismaClient, Prisma } from "@prisma/client";

const EXCHANGE_NAME = "erp.activity";
const QUEUE_NAME = "project.activity-logger";

interface ActivityEvent {
  action: string;
  userId: string;
  entityType: string;
  entityId: string;
  description: string;
  metadata?: Record<string, unknown>;
  timestamp?: string;
}

export class ActivityEventConsumer {
  private connection: Awaited<ReturnType<typeof amqplib.connect>> | null = null;
  private channel: Channel | null = null;

  constructor(private readonly prisma: PrismaClient) {}

  async start(): Promise<void> {
    const url = process.env.RABBITMQ_URL;
    if (!url) {
      console.warn("[event-consumer] RABBITMQ_URL not set, skipping consumer");
      return;
    }

    try {
      this.connection = await amqplib.connect(url);
      this.channel = await this.connection.createChannel();

      await this.channel.assertExchange(EXCHANGE_NAME, "fanout", { durable: true });
      await this.channel.assertQueue(QUEUE_NAME, { durable: true });
      await this.channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, "");
      await this.channel.prefetch(10);

      this.channel.consume(QUEUE_NAME, async (msg: ConsumeMessage | null) => {
        if (!msg) return;

        try {
          const event: ActivityEvent = JSON.parse(msg.content.toString());
          await this.prisma.activityLog.create({
            data: {
              userId: event.userId,
              action: event.action,
              entityType: event.entityType,
              entityId: event.entityId,
              description: event.description,
              metadata: (event.metadata ?? null) as Prisma.InputJsonValue,
            },
          });
          this.channel!.ack(msg);
        } catch (err) {
          console.error("[event-consumer] Failed to process message:", (err as Error)?.message);
          this.channel!.nack(msg, false, false);
        }
      });

      this.connection.on("error", (err: Error) => {
        console.error("[event-consumer] Connection error:", err.message);
      });
      this.connection.on("close", () => {
        console.warn("[event-consumer] Connection closed, will retry in 5s");
        setTimeout(() => this.start(), 5000);
      });

      console.log("[event-consumer] Listening on queue:", QUEUE_NAME);
    } catch (err) {
      console.error("[event-consumer] Failed to start:", (err as Error).message);
      setTimeout(() => this.start(), 5000);
    }
  }

  async stop(): Promise<void> {
    try {
      if (this.channel) await this.channel.close();
      if (this.connection) await this.connection.close();
    } catch { /* ignore */ }
    this.channel = null;
    this.connection = null;
  }
}
