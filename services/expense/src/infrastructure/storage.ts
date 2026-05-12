// 영수증 첨부 저장 — services/auth/src/infrastructure/attachment-storage.ts 패턴 동일
// 도메인 격리를 위해 expense-service 내부 구현

import { promises as fs, createReadStream } from "fs";
import path from "path";
import { randomBytes } from "crypto";

export interface SaveResult {
  storageKey: string;
  diskPath: string;
}

export class LocalFsStorage {
  constructor(private readonly rootDir: string) {}

  async save(buffer: Buffer, fileName: string): Promise<SaveResult> {
    const safeName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
    const ext = path.extname(safeName).toLowerCase() || ".jpg";
    const ym = new Date().toISOString().slice(0, 7);
    const id = randomBytes(12).toString("hex");
    const storageKey = `receipts/${ym}/${id}${ext}`;
    const diskPath = path.join(this.rootDir, storageKey);
    await fs.mkdir(path.dirname(diskPath), { recursive: true });
    await fs.writeFile(diskPath, buffer);
    return { storageKey, diskPath };
  }

  read(storageKey: string): NodeJS.ReadableStream {
    return createReadStream(this.resolveDiskPath(storageKey));
  }

  async remove(storageKey: string): Promise<void> {
    try {
      await fs.unlink(this.resolveDiskPath(storageKey));
    } catch {
      /* ignore */
    }
  }

  resolveDiskPath(storageKey: string): string {
    const normalized = path.normalize(storageKey);
    if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
      throw new Error("Invalid storage key");
    }
    return path.join(this.rootDir, normalized);
  }
}

const ALLOWED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf"]);
const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
]);

export function validateReceipt(input: { fileName: string; fileSize: number; mimeType: string; maxSize: number }):
  | { ok: true }
  | { ok: false; code: "FILE_TOO_LARGE" | "UNSUPPORTED_TYPE"; message: string } {
  if (input.fileSize > input.maxSize) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      message: `파일 크기가 ${Math.floor(input.maxSize / 1024 / 1024)}MB를 초과합니다.`,
    };
  }
  const ext = (input.fileName.match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { ok: false, code: "UNSUPPORTED_TYPE", message: `허용되지 않는 파일 형식: ${ext}` };
  }
  if (!ALLOWED_MIME.has(input.mimeType)) {
    return { ok: false, code: "UNSUPPORTED_TYPE", message: `허용되지 않는 MIME: ${input.mimeType}` };
  }
  return { ok: true };
}
