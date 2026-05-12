// OCR 인식률 개선용 이미지 전처리.
// 기울어짐(EXIF 회전), 음영, 약한 대비를 보정해 clova-ocr 인식률을 높임.
// 심한 skew/조명은 보정 어려우므로 fallback으로 claude-vision 사용 (preprocess.ts 외부).

import sharp from "sharp";

export interface PreprocessResult {
  buffer: Buffer;
  applied: string[]; // 어떤 변환이 적용됐는지 (디버깅·로그용)
  width: number;
  height: number;
}

const MAX_DIM = 4000; // Clova/claude-vision 모두 너무 큰 이미지는 비효율 → 다운스케일

export async function preprocessForOcr(input: Buffer): Promise<PreprocessResult> {
  const applied: string[] = [];
  let pipe = sharp(input).rotate(); // EXIF orientation 기반 자동 회전 (90/180/270°)
  applied.push("auto-rotate");

  const meta = await pipe.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;

  // 큰 이미지 다운스케일 — Clova도 4K 이상에서 처리 시간 급증, 정확도 향상 미미
  if (w > MAX_DIM || h > MAX_DIM) {
    pipe = pipe.resize({ width: MAX_DIM, height: MAX_DIM, fit: "inside", withoutEnlargement: true });
    applied.push(`resize<=${MAX_DIM}`);
  }

  // 그레이스케일 + normalize (대비 정규화) — 음영/조명 불균일 보정
  pipe = pipe.greyscale().normalise();
  applied.push("greyscale");
  applied.push("normalise");

  // 약한 sharpen — 텍스트 엣지 보강. 너무 강하면 노이즈 증가.
  pipe = pipe.sharpen({ sigma: 0.8 });
  applied.push("sharpen(0.8)");

  // JPEG 출력 (Clova/claude-vision 모두 jpeg 선호, 파일 크기 작음)
  const buffer = await pipe.jpeg({ quality: 92 }).toBuffer({ resolveWithObject: true });

  return {
    buffer: buffer.data,
    applied,
    width: buffer.info.width,
    height: buffer.info.height,
  };
}
