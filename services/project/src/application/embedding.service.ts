import type { FastifyBaseLogger } from "fastify";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://ollama:11434";
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "bge-m3";
const EMBEDDING_TIMEOUT_MS = parseInt(process.env.EMBEDDING_TIMEOUT_MS ?? "5000", 10);
const MAX_INPUT_CHARS = 5000;

export class EmbeddingService {
  constructor(private readonly logger: FastifyBaseLogger) {}

  /**
   * 텍스트를 임베딩 벡터로 변환합니다 (bge-m3, 1024차원).
   * 길이 상한: 5000자 (초과 시 truncate).
   */
  async embedText(text: string): Promise<number[]> {
    const truncated = text.slice(0, MAX_INPUT_CHARS);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS);

    try {
      const res = await fetch(`${OLLAMA_URL}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: truncated,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Ollama ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as { embeddings?: number[][] };
      const vec = data.embeddings?.[0];
      if (!vec || vec.length === 0) {
        throw new Error("Empty embedding");
      }
      return vec;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * SQL용 vector 리터럴 (예: '[0.1,0.2,...]')
   */
  toSqlLiteral(vec: number[]): string {
    return `[${vec.join(",")}]`;
  }
}
