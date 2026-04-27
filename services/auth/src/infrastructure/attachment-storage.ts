import { promises as fs, createReadStream } from "fs";
import path from "path";
import { randomBytes } from "crypto";

export interface SaveResult {
  storageKey: string;
  diskPath: string;
}

export interface AttachmentStorage {
  save(buffer: Buffer, fileName: string): Promise<SaveResult>;
  read(storageKey: string): NodeJS.ReadableStream;
  remove(storageKey: string): Promise<void>;
  resolveDiskPath(storageKey: string): string;
}

const DEFAULT_DIR = "/data/uploads/board";

export class LocalFsStorage implements AttachmentStorage {
  private readonly rootDir: string;

  constructor(rootDir?: string) {
    this.rootDir = rootDir ?? process.env.BOARD_ATTACHMENT_DIR ?? DEFAULT_DIR;
  }

  async save(buffer: Buffer, fileName: string): Promise<SaveResult> {
    const safeName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
    const ext = path.extname(safeName);
    const ym = new Date().toISOString().slice(0, 7); // YYYY-MM
    const id = randomBytes(12).toString("hex");
    const storageKey = `${ym}/${id}${ext}`;
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
    // 경로 escape 방지
    const normalized = path.normalize(storageKey);
    if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
      throw new Error("Invalid storage key");
    }
    return path.join(this.rootDir, normalized);
  }
}

const ALLOWED_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp",
  ".pdf",
  ".xlsx", ".xls", ".csv",
  ".docx", ".doc", ".pptx", ".ppt",
  ".txt", ".md",
]);

const ALLOWED_MIME = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "text/plain", "text/markdown",
]);

export const ATTACHMENT_MAX_SIZE = parseInt(process.env.BOARD_ATTACHMENT_MAX_SIZE ?? "52428800", 10);

export interface ValidateAttachmentInput {
  fileName: string;
  fileSize: number;
  mimeType: string;
}

export type ValidateAttachmentResult =
  | { ok: true }
  | { ok: false; code: "FILE_TOO_LARGE" | "UNSUPPORTED_TYPE"; message: string };

export function validateAttachment(input: ValidateAttachmentInput): ValidateAttachmentResult {
  if (input.fileSize > ATTACHMENT_MAX_SIZE) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      message: `파일 크기가 ${Math.floor(ATTACHMENT_MAX_SIZE / 1024 / 1024)}MB를 초과합니다.`,
    };
  }
  const ext = path.extname(input.fileName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { ok: false, code: "UNSUPPORTED_TYPE", message: `허용되지 않는 파일 형식: ${ext}` };
  }
  if (!ALLOWED_MIME.has(input.mimeType)) {
    return { ok: false, code: "UNSUPPORTED_TYPE", message: `허용되지 않는 MIME: ${input.mimeType}` };
  }
  return { ok: true };
}
