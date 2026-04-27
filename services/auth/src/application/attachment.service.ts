import { PrismaClient } from "@prisma/client";
import type { AuthUserContext } from "../domain/board.types";
import { AttachmentStorage, validateAttachment } from "../infrastructure/attachment-storage";
import { canRead } from "./board-permissions";

export class AttachmentError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
    this.name = "AttachmentError";
  }
}

export class AttachmentService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: AttachmentStorage,
  ) {}

  async upload(input: {
    buffer: Buffer;
    fileName: string;
    fileSize: number;
    mimeType: string;
    isInline: boolean;
  }, user: AuthUserContext) {
    const v = validateAttachment({
      fileName: input.fileName,
      fileSize: input.fileSize,
      mimeType: input.mimeType,
    });
    if (!v.ok) {
      const status = v.code === "FILE_TOO_LARGE" ? 413 : 415;
      throw new AttachmentError(v.code, v.message, status);
    }

    const { storageKey } = await this.storage.save(input.buffer, input.fileName);
    return this.prisma.attachment.create({
      data: {
        uploadedBy: user.id,
        fileName: input.fileName,
        fileSize: input.fileSize,
        mimeType: input.mimeType,
        storageKey,
        isInline: input.isInline,
        // postId는 글 작성 시점에 연결됨
      },
    });
  }

  async getDownload(attachmentId: string, user: AuthUserContext) {
    const att = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
      include: {
        post: { include: { board: true } },
      },
    });
    if (!att) throw new AttachmentError("NOT_FOUND", "첨부파일을 찾을 수 없습니다.", 404);

    // 글에 연결된 첨부는 audience 검증, 임시(=postId null)는 업로더 본인만
    if (att.post) {
      if (!canRead(att.post.board, att.post, user)) {
        throw new AttachmentError("FORBIDDEN_READ", "읽기 권한이 없습니다.", 403);
      }
    } else {
      if (att.uploadedBy !== user.id && user.role !== "ADMIN") {
        throw new AttachmentError("FORBIDDEN_READ", "읽기 권한이 없습니다.", 403);
      }
    }

    return {
      stream: this.storage.read(att.storageKey),
      fileName: att.fileName,
      mimeType: att.mimeType,
      fileSize: att.fileSize,
    };
  }
}
