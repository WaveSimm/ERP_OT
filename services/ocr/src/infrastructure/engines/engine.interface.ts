export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextBlock {
  text: string;
  confidence: number;
  boundingBox: BoundingBox;
}

export interface OcrRawResult {
  texts: TextBlock[];
  imageWidth: number;
  imageHeight: number;
  processingTimeMs: number;
  extractionMethod?: "text-extract" | "ocr";
  engineId?: string;
}

export interface EngineInfo {
  id: string;
  name: string;
  group: string;
  lang: string;
  ready: boolean;
}

export interface OcrEngine {
  scan(image: Buffer, engineId?: string, forceOcr?: boolean): Promise<OcrRawResult>;
  healthCheck(): Promise<boolean>;
  listEngines(): Promise<EngineInfo[]>;
}
