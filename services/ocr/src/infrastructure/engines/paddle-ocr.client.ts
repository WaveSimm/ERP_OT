import { OcrEngine, OcrRawResult, TextBlock, EngineInfo } from "./engine.interface.js";

export class PaddleOcrClient implements OcrEngine {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async scan(image: Buffer, engineId: string = "paddle-ko", forceOcr: boolean = false): Promise<OcrRawResult> {
    const boundary = `----formdata-${Date.now()}`;
    const crlf = "\r\n";
    const header = `--${boundary}${crlf}Content-Disposition: form-data; name="file"; filename="scan.png"${crlf}Content-Type: image/png${crlf}${crlf}`;
    const footer = `${crlf}--${boundary}--${crlf}`;

    const body = Buffer.concat([
      Buffer.from(header),
      image,
      Buffer.from(footer),
    ]);

    const url = `${this.baseUrl}/ocr/scan?engine=${encodeURIComponent(engineId)}${forceOcr ? '&force_ocr=true' : ''}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OCR engine error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      engine_id: string;
      extraction_method?: string;
      texts: Array<{
        text: string;
        confidence: number;
        bounding_box: { x: number; y: number; width: number; height: number };
      }>;
      image_width: number;
      image_height: number;
      processing_time_ms: number;
    };

    const texts: TextBlock[] = data.texts.map((t) => ({
      text: t.text,
      confidence: t.confidence,
      boundingBox: {
        x: t.bounding_box.x,
        y: t.bounding_box.y,
        width: t.bounding_box.width,
        height: t.bounding_box.height,
      },
    }));

    return {
      texts,
      imageWidth: data.image_width,
      imageHeight: data.image_height,
      processingTimeMs: data.processing_time_ms,
      extractionMethod: (data.extraction_method as "text-extract" | "ocr") ?? "ocr",
      engineId: data.engine_id,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async listEngines(): Promise<EngineInfo[]> {
    try {
      const response = await fetch(`${this.baseUrl}/engines`);
      if (!response.ok) return [];
      return await response.json() as EngineInfo[];
    } catch {
      return [];
    }
  }
}
