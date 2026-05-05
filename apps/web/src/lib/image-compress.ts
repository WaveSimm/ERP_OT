/**
 * 클라이언트 측 이미지 리사이즈 + 압축 helper.
 *
 * - 최대 변(long edge) 기본 1920px, JPEG 품질 0.85
 * - 의존성 0 — 브라우저 표준 API (createImageBitmap + OffscreenCanvas)
 * - 이미 작은 이미지(<500KB)는 그대로 통과 (skip)
 * - 비이미지 파일도 그대로 통과
 * - HEIC/HEIF는 1차 미지원 (백로그)
 *
 * 사용처: 점검보고서 단계별 첨부, 게시판 AttachmentUploader 등 모든 업로드 폼.
 * 수리관리 v2.2 (2026-05-05)
 */

export interface CompressOptions {
  /** 결과 이미지의 최대 변(long edge). 기본 1920 */
  maxDim?: number;
  /** JPEG 품질 0~1. 기본 0.85 */
  quality?: number;
  /** 이 크기 미만이면 압축 skip (기본 500KB) */
  skipBelowBytes?: number;
}

const DEFAULTS: Required<CompressOptions> = {
  maxDim: 1920,
  quality: 0.85,
  skipBelowBytes: 500 * 1024,
};

/**
 * 이미지 파일이면 리사이즈·재인코딩, 아니면 원본 반환.
 * 실패 시 원본 반환 (안전 폴백).
 */
export async function compressImage(file: File, opts: CompressOptions = {}): Promise<File> {
  const { maxDim, quality, skipBelowBytes } = { ...DEFAULTS, ...opts };

  if (!file.type.startsWith("image/")) return file;
  // SVG는 벡터라 리사이즈 의미 없음 — 그대로
  if (file.type === "image/svg+xml") return file;
  if (file.size < skipBelowBytes) return file;

  // 브라우저 호환성 체크
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas === "undefined") {
    return file;
  }

  try {
    const bmp = await createImageBitmap(file);
    const ratio = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * ratio);
    const h = Math.round(bmp.height * ratio);
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bmp, 0, 0, w, h);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    bmp.close?.();

    // 원본보다 더 커지면 그대로 반환 (드물지만 가능)
    if (blob.size >= file.size) return file;

    const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], newName, { type: "image/jpeg", lastModified: Date.now() });
  } catch (err) {
    console.warn("[image-compress] failed, using original:", err);
    return file;
  }
}

/**
 * 여러 파일 일괄 압축 (Promise.all).
 */
export function compressImages(files: File[], opts?: CompressOptions): Promise<File[]> {
  return Promise.all(files.map((f) => compressImage(f, opts)));
}
