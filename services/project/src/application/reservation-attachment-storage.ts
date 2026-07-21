import fs from "node:fs";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { AppError } from "@erp-ot/shared";

// 예약(차량정비 등) 첨부 저장 유틸 (2026-07-21)
//   태스크 첨부(collab.service)의 파일 I/O 핵심을 복제한 독립 모듈.
//   태스크 코드를 건드리지 않기 위해 별도로 둠 — 세 번째 사용처가 생기면 공용화 검토.

export const RESERVATION_MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

export type AttachmentCategory = "FILE" | "IMAGE";

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp"]);
const FILE_EXTS = new Set(["pdf", "hwp", "hwpx", "doc", "docx", "xls", "xlsx", "ppt", "pptx"]);

// 경로 세그먼트 안전화 — 한글 보존, 경로 위험문자·제어문자만 치환
export function sanitizeSegment(s: string): string {
  const cleaned = s
    // eslint-disable-next-line no-control-regex -- 제어문자 치환이 목적
    .replace(/[/\\:*?"<>|\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^\.+|\.+$/g, "")
    .trim();
  return cleaned || "_";
}

// 확장자 검증 → 소문자 확장자 반환(없거나 불허 시 400)
export function validateExtension(filename: string, category: AttachmentCategory): string {
  const ext = path.extname(filename).slice(1).toLowerCase();
  const allowed = category === "IMAGE" ? IMAGE_EXTS : FILE_EXTS;
  if (!ext || !allowed.has(ext)) {
    const hint = category === "IMAGE" ? "jpg, jpeg, png, gif, webp" : "pdf, hwp, hwpx, doc(x), xls(x), ppt(x)";
    throw new AppError(400, "UNSUPPORTED_EXTENSION", `허용되지 않은 확장자입니다. (허용: ${hint})`);
  }
  return ext;
}

// 저장 경로 계산: <STORAGE_PATH>/ERP/공용자산/차량/<자원명>__<resourceId>/<reservationId>/<파일|이미지>
//   자원명(번호판)이 바뀌어도 뒤의 __<resourceId>로 폴더를 식별해 재사용.
export async function resolveReservationDir(
  storagePath: string,
  resourceName: string,
  resourceId: string,
  reservationId: string,
  category: AttachmentCategory,
): Promise<string> {
  const vehiclesRoot = path.join(storagePath, "ERP", "공용자산", "차량");
  await fs.promises.mkdir(vehiclesRoot, { recursive: true });

  let resourceFolder: string | undefined;
  try {
    const entries = await fs.promises.readdir(vehiclesRoot, { withFileTypes: true });
    const found = entries.find((e) => e.isDirectory() && e.name.endsWith(`__${resourceId}`));
    if (found) resourceFolder = found.name;
  } catch { /* 최초 업로드 시 없음 */ }
  if (!resourceFolder) {
    resourceFolder = `${sanitizeSegment(resourceName)}__${resourceId}`;
  }

  const categoryFolder = category === "IMAGE" ? "이미지" : "파일";
  const dirPath = path.join(vehiclesRoot, resourceFolder, reservationId, categoryFolder);
  await fs.promises.mkdir(dirPath, { recursive: true });
  return dirPath;
}

// 스트림을 디스크에 기록(용량 제한·중복명 처리) → { filePath, fileSize }
export async function writeStreamToFile(
  dirPath: string,
  originalFilename: string,
  uploaderName: string,
  ext: string,
  fileStream: NodeJS.ReadableStream,
): Promise<{ filePath: string; fileSize: number }> {
  const baseName = sanitizeSegment(path.basename(originalFilename, path.extname(originalFilename)));
  const uploader = sanitizeSegment(uploaderName);
  let diskName = `${baseName}_${uploader}.${ext}`;
  for (let n = 2; fs.existsSync(path.join(dirPath, diskName)); n++) {
    diskName = `${baseName}_${uploader}_${n}.${ext}`;
  }
  const filePath = path.join(dirPath, diskName);

  let fileSize = 0;
  const sizeLimit = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      fileSize += chunk.length;
      if (fileSize > RESERVATION_MAX_FILE_SIZE) cb(new Error("FILE_TOO_LARGE"));
      else cb(null, chunk);
    },
  });

  const writeStream = fs.createWriteStream(filePath);
  try {
    await pipeline(fileStream as NodeJS.ReadableStream & AsyncIterable<unknown>, sizeLimit, writeStream);
  } catch (err: unknown) {
    await fs.promises.unlink(filePath).catch(() => {});
    if (err instanceof Error && err.message === "FILE_TOO_LARGE") {
      throw new AppError(413, "FILE_TOO_LARGE", "파일 크기는 50MB를 초과할 수 없습니다.");
    }
    throw err;
  }
  return { filePath, fileSize };
}
