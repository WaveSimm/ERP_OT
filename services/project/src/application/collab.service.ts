import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { AppError } from "@erp-ot/shared";
import { ProjectGateway } from "../infrastructure/websocket/project.gateway.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
]);

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface CreateCommentDto {
  content: string;
  mentionedUserIds?: string[];
}

export interface UpdateCommentDto {
  content: string;
  mentionedUserIds?: string[];
}

export interface UploadFileDto {
  filename: string;
  mimetype: string;
  file: NodeJS.ReadableStream;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class CollabService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly gateway: ProjectGateway,
    private readonly storagePath: string,
  ) {}

  // ─── Comments ─────────────────────────────────────────────────────────────

  async listComments(taskId: string) {
    await this.requireTask(taskId);
    return this.prisma.comment.findMany({
      where: { taskId },
      include: { mentions: true },
      orderBy: { createdAt: "asc" },
    });
  }

  async createComment(taskId: string, dto: CreateCommentDto, authorId: string) {
    const task = await this.requireTask(taskId);

    const comment = await this.prisma.comment.create({
      data: {
        taskId,
        content: dto.content,
        authorId,
        ...(dto.mentionedUserIds && dto.mentionedUserIds.length > 0
          ? { mentions: { create: dto.mentionedUserIds.map((userId) => ({ userId })) } }
          : {}),
      } as any,
      include: { mentions: true },
    });

    await this.logActivity(
      task.projectId,
      authorId,
      "COMMENT_CREATED",
      "comment",
      comment.id,
      `댓글 작성`,
      { taskName: task.name, taskId, content: dto.content.slice(0, 200) },
    );

    await this.prisma.taskScheduleHistory.create({
      data: {
        taskId,
        changedBy: authorId,
        changeType: "COMMENT_ADDED",
        changeReason: "댓글 작성",
        field: "comment",
        newValue: dto.content.slice(0, 500),
      },
    });

    this.gateway.emitToProject(task.projectId, "comment:created", {
      taskId,
      projectId: task.projectId,
      comment: comment as unknown as Record<string, unknown>,
    });

    const mentions = (comment as any).mentions as Array<{ userId: string }> | undefined;
    for (const mention of mentions ?? []) {
      this.gateway.emitToUser(mention.userId, "mention:created", {
        commentId: comment.id,
        taskId,
        projectId: task.projectId,
        authorId,
        content: dto.content,
      });
    }

    return comment;
  }

  async updateComment(commentId: string, dto: UpdateCommentDto, userId: string) {
    const existing = await this.prisma.comment.findUnique({
      where: { id: commentId },
      include: { task: true },
    });
    if (!existing) throw new AppError(404, "COMMENT_NOT_FOUND", "댓글을 찾을 수 없습니다.");
    if (existing.authorId !== userId) {
      throw new AppError(403, "FORBIDDEN", "본인 댓글만 수정할 수 있습니다.");
    }

    const comment = await this.prisma.$transaction(async (tx) => {
      await tx.mention.deleteMany({ where: { commentId } });
      return tx.comment.update({
        where: { id: commentId },
        data: {
          content: dto.content,
          ...(dto.mentionedUserIds && dto.mentionedUserIds.length > 0
            ? { mentions: { create: dto.mentionedUserIds.map((uid) => ({ userId: uid })) } }
            : {}),
        },
        include: { mentions: true },
      });
    });

    await this.logActivity(
      existing.task.projectId,
      userId,
      "COMMENT_UPDATED",
      "comment",
      commentId,
      `댓글 수정`,
      { taskName: existing.task.name, taskId: existing.taskId, content: dto.content.slice(0, 200) },
    );

    await this.prisma.taskScheduleHistory.create({
      data: {
        taskId: existing.taskId,
        changedBy: userId,
        changeType: "COMMENT_EDITED",
        changeReason: "댓글 수정",
        field: "comment",
        oldValue: existing.content.slice(0, 500),
        newValue: dto.content.slice(0, 500),
      },
    });

    this.gateway.emitToProject(existing.task.projectId, "comment:updated", {
      commentId,
      taskId: existing.taskId,
      content: dto.content,
    });

    return comment;
  }

  async deleteComment(commentId: string, userId: string, userRole: string) {
    const existing = await this.prisma.comment.findUnique({
      where: { id: commentId },
      include: { task: true },
    });
    if (!existing) throw new AppError(404, "COMMENT_NOT_FOUND", "댓글을 찾을 수 없습니다.");
    if (existing.authorId !== userId && !["ADMIN", "MANAGER"].includes(userRole)) {
      throw new AppError(403, "FORBIDDEN", "삭제 권한이 없습니다.");
    }

    await this.prisma.comment.delete({ where: { id: commentId } });

    await this.logActivity(
      existing.task.projectId,
      userId,
      "COMMENT_DELETED",
      "comment",
      commentId,
      "댓글 삭제",
    );

    await this.prisma.taskScheduleHistory.create({
      data: {
        taskId: existing.taskId,
        changedBy: userId,
        changeType: "COMMENT_DELETED",
        changeReason: "댓글 삭제",
        field: "comment",
        oldValue: existing.content.slice(0, 500),
      },
    });

    this.gateway.emitToProject(existing.task.projectId, "comment:deleted", {
      commentId,
      taskId: existing.taskId,
    });
  }

  // ─── Attachments ───────────────────────────────────────────────────────────

  async listAttachments(taskId: string) {
    await this.requireTask(taskId);
    return this.prisma.attachment.findMany({
      where: { taskId },
      orderBy: { createdAt: "desc" },
    });
  }

  async uploadAttachment(taskId: string, uploadedBy: string, fileDto: UploadFileDto) {
    const task = await this.requireTask(taskId);

    if (!ALLOWED_MIME_TYPES.has(fileDto.mimetype)) {
      throw new AppError(400, "UNSUPPORTED_MIME_TYPE", "지원하지 않는 파일 형식입니다.");
    }

    const timestamp = Date.now();
    const safeFilename = path.basename(fileDto.filename).replace(/[^a-zA-Z0-9._-]/g, "_");
    const dirPath = path.join(this.storagePath, task.projectId, taskId);
    const filePath = path.join(dirPath, `${timestamp}_${safeFilename}`);

    await fs.promises.mkdir(dirPath, { recursive: true });

    let fileSize = 0;
    const sizeLimitTransform = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        fileSize += chunk.length;
        if (fileSize > MAX_FILE_SIZE) {
          cb(new Error("FILE_TOO_LARGE"));
        } else {
          cb(null, chunk);
        }
      },
    });

    const writeStream = fs.createWriteStream(filePath);
    try {
      await pipeline(fileDto.file as NodeJS.ReadableStream & AsyncIterable<unknown>, sizeLimitTransform, writeStream);
    } catch (err: unknown) {
      await fs.promises.unlink(filePath).catch(() => {});
      const msg = err instanceof Error ? err.message : "";
      if (msg === "FILE_TOO_LARGE") {
        throw new AppError(413, "FILE_TOO_LARGE", "파일 크기는 50MB를 초과할 수 없습니다.");
      }
      throw err;
    }

    const attachment = await this.prisma.attachment.create({
      data: {
        taskId,
        fileName: fileDto.filename,
        fileSize,
        mimeType: fileDto.mimetype,
        storagePath: filePath,
        uploadedBy,
      },
    });

    await this.logActivity(
      task.projectId,
      uploadedBy,
      "ATTACHMENT_UPLOADED",
      "attachment",
      attachment.id,
      `파일 첨부: ${fileDto.filename}`,
    );

    this.gateway.emitToProject(task.projectId, "attachment:created", {
      taskId,
      projectId: task.projectId,
      attachment: attachment as unknown as Record<string, unknown>,
    });

    return attachment;
  }

  async getAttachmentForDownload(attachmentId: string) {
    const attachment = await this.prisma.attachment.findUnique({ where: { id: attachmentId } });
    if (!attachment) throw new AppError(404, "ATTACHMENT_NOT_FOUND", "첨부 파일을 찾을 수 없습니다.");

    try {
      await fs.promises.access(attachment.storagePath, fs.constants.R_OK);
    } catch {
      throw new AppError(404, "FILE_NOT_FOUND", "파일을 찾을 수 없습니다.");
    }

    return {
      attachment,
      stream: fs.createReadStream(attachment.storagePath),
    };
  }

  async deleteAttachment(attachmentId: string, userId: string, userRole: string) {
    const attachment = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
      include: { task: true },
    });
    if (!attachment) throw new AppError(404, "ATTACHMENT_NOT_FOUND", "첨부 파일을 찾을 수 없습니다.");
    if (attachment.uploadedBy !== userId && !["ADMIN", "MANAGER"].includes(userRole)) {
      throw new AppError(403, "FORBIDDEN", "삭제 권한이 없습니다.");
    }

    await this.prisma.attachment.delete({ where: { id: attachmentId } });
    await fs.promises.unlink(attachment.storagePath).catch(() => {});

    await this.logActivity(
      attachment.task.projectId,
      userId,
      "ATTACHMENT_DELETED",
      "attachment",
      attachmentId,
      `파일 삭제: ${attachment.fileName}`,
    );

    this.gateway.emitToProject(attachment.task.projectId, "attachment:deleted", {
      attachmentId,
      taskId: attachment.taskId,
    });
  }

  // ─── Activity Feed ────────────────────────────────────────────────────────

  async listActivities(projectId: string, page: number, pageSize: number) {
    const skip = (page - 1) * pageSize;
    const [items, total] = await Promise.all([
      this.prisma.activityLog.findMany({
        where: { projectId },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      this.prisma.activityLog.count({ where: { projectId } }),
    ]);

    // COMMENT_CREATED / COMMENT_UPDATED: entityId = comment.id → 실제 내용 조인
    const commentActivityIds = items
      .filter((a) => a.action === "COMMENT_CREATED" || a.action === "COMMENT_UPDATED")
      .map((a) => a.entityId);

    const commentContentMap = new Map<string, string>();
    if (commentActivityIds.length > 0) {
      const comments = await this.prisma.comment.findMany({
        where: { id: { in: commentActivityIds } },
        select: { id: true, content: true },
      });
      for (const c of comments) {
        commentContentMap.set(c.id, c.content);
      }
    }

    const enriched = items.map((a) => {
      const content = commentContentMap.get(a.entityId);
      if (content !== undefined) {
        return { ...a, description: content.slice(0, 200) };
      }
      return a;
    });

    return { items: enriched, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────

  private async requireTask(taskId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
    });
    if (!task) throw new AppError(404, "TASK_NOT_FOUND", "태스크를 찾을 수 없습니다.");
    return task;
  }

  private async logActivity(
    projectId: string,
    userId: string,
    action: string,
    entityType: string,
    entityId: string,
    description: string,
    metadata?: Record<string, unknown>,
  ) {
    const log = await this.prisma.activityLog.create({
      data: {
        projectId,
        userId,
        action,
        entityType,
        entityId,
        description,
        ...(metadata !== undefined ? { metadata } : {}),
      } as any,
    });
    this.gateway.emitToProject(projectId, "activity:created", {
      log: log as unknown as Record<string, unknown>,
    });
    return log;
  }
}
