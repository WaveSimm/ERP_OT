import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(16),
  PORT: z.string().default("3007"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  CORS_ORIGIN: z.string().default("*"),
  INTERNAL_API_TOKEN: z.string().min(16),
  OCR_ENGINE_URL: z.string().default("http://ocr-engine:8000"),
  EQUIPMENT_SERVICE_URL: z.string().default("http://equipment-service:3005"),
  AUTH_SERVICE_URL: z.string().default("http://auth-service:3001"),
  UPLOAD_DIR: z.string().default("./uploads"),
  MAX_FILE_SIZE_MB: z.string().default("10"),
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;
