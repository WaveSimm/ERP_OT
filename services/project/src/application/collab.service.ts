import { PrismaClient, Prisma } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { AppError } from "@erp-ot/shared";
import { ProjectGateway } from "../infrastructure/websocket/project.gateway.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

// 업로드 종류
export type AttachmentCategory = "FILE" | "IMAGE";

// 확장자 기준 화이트리스트 (hwp 등은 브라우저 MIME가 불안정해 확장자를 진짜 기준으로 삼음).
// 서버는 파일을 실행/렌더링하지 않고 저장·스트리밍만 하며, 다운로드는 attachment+nosniff로 강제되어
// html/svg/스크립트/실행파일을 제외하면 서버·브라우저 보안 위험이 없음.
const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp"]);
const FILE_EXTS = new Set(["pdf", "hwp", "hwpx", "doc", "docx", "xls", "xlsx", "ppt", "pptx"]);

// 경로 세그먼트 안전화 — 한글은 보존하고 경로 위험문자·제어문자만 치환
function sanitizeSegment(s: string): string {
  const cleaned = s
    // eslint-disable-next-line no-control-regex -- 제어문자 치환이 목적
    .replace(/[/\\:*?"<>|\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^\.+|\.+$/g, "")
    .trim();
  return cleaned || "_";
}

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface CreateCommentDto {
  content: string;
  mentionedUserIds?: string[] | undefined;
}

export interface UpdateCommentDto {
  content: string;
  mentionedUserIds?: string[] | undefined;
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
    const comments = await this.prisma.comment.findMany({
      where: { taskId },
      include: { mentions: true },
      orderBy: { createdAt: "asc" },
    });
    // authorId → authorName 일괄 조회 (auth-service /internal/users/bulk)
    const authorIds = [...new Set(comments.map((c) => c.authorId).filter(Boolean))];
    const nameMap = await this.fetchUserNames(authorIds);
    return comments.map((c) => ({ ...c, authorName: nameMap.get(c.authorId) ?? null }));
  }

  private async fetchUserNames(ids: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (ids.length === 0) return map;
    try {
      const authUrl = process.env.AUTH_SERVICE_URL ?? "http://auth-service:3001";
      const res = await fetch(
        `${authUrl}/internal/users/bulk?ids=${ids.join(",")}`,
        // 보안 일괄패치 PDCA Layer 1 (C3): startup-time Zod env 검증으로 보장
        { headers: { "X-Internal-Token": process.env.INTERNAL_API_TOKEN as string } },
      );
      if (res.ok) {
        const data = (await res.json()) as Record<string, { name: string }>;
        Object.entries(data).forEach(([id, u]) => map.set(id, u.name));
      }
    } catch { /* ignore */ }
    return map;
  }

  async createComment(taskId: string, dto: CreateCommentDto, authorId: string) {
    const task = await this.requireTask(taskId);

    const data: Prisma.CommentUncheckedCreateInput = { taskId, content: dto.content, authorId };
    if (dto.mentionedUserIds && dto.mentionedUserIds.length > 0) {
      data.mentions = { create: dto.mentionedUserIds.map((userId) => ({ userId })) };
    }
    const comment = await this.prisma.comment.create({
      data,
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

    const mentions = comment.mentions;
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

  async uploadAttachment(
    taskId: string,
    uploadedBy: string,
    fileDto: UploadFileDto,
    category: AttachmentCategory = "FILE",
  ) {
    const task = await this.requireTask(taskId);

    // 확장자 기준 검증 (종류별 화이트리스트)
    const ext = path.extname(fileDto.filename).slice(1).toLowerCase();
    const allowed = category === "IMAGE" ? IMAGE_EXTS : FILE_EXTS;
    if (!ext || !allowed.has(ext)) {
      const hint = category === "IMAGE" ? "jpg, jpeg, png, gif, webp" : "pdf, hwp, hwpx, doc(x), xls(x), ppt(x)";
      throw new AppError(400, "UNSUPPORTED_EXTENSION", `허용되지 않은 확장자입니다. (허용: ${hint})`);
    }

    // 저장 경로: <STORAGE_PATH>/ERP/<프로젝트명>__<projectId>/<파일|이미지>/<원본명>_<업로더>[_n].<ext>
    //  - projectId 접미사로 폴더를 식별 → 프로젝트명이 바뀌어도 기존 폴더 재사용(파일 분산 방지)
    const erpRoot = path.join(this.storagePath, "ERP");
    await fs.promises.mkdir(erpRoot, { recursive: true });

    let projectFolder: string | undefined;
    try {
      const entries = await fs.promises.readdir(erpRoot, { withFileTypes: true });
      const found = entries.find((e) => e.isDirectory() && e.name.endsWith(`__${task.projectId}`));
      if (found) projectFolder = found.name;
    } catch { /* 최초 업로드 시 디렉터리 없음 */ }
    if (!projectFolder) {
      const project = await this.prisma.project.findUnique({
        where: { id: task.projectId },
        select: { name: true },
      });
      projectFolder = `${sanitizeSegment(project?.name ?? "project")}__${task.projectId}`;
    }

    const categoryFolder = category === "IMAGE" ? "이미지" : "파일";
    const dirPath = path.join(erpRoot, projectFolder, categoryFolder);
    await fs.promises.mkdir(dirPath, { recursive: true });

    // 파일명 = 원본명(확장자 제외)_업로더한글명[.ext], 중복 시 _2, _3 …
    const nameMap = await this.fetchUserNames([uploadedBy]);
    const uploaderName = sanitizeSegment(nameMap.get(uploadedBy) ?? uploadedBy);
    const baseName = sanitizeSegment(path.basename(fileDto.filename, path.extname(fileDto.filename)));
    let diskName = `${baseName}_${uploaderName}.${ext}`;
    for (let n = 2; fs.existsSync(path.join(dirPath, diskName)); n++) {
      diskName = `${baseName}_${uploaderName}_${n}.${ext}`;
    }
    const filePath = path.join(dirPath, diskName);

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
        category,
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
        ...(metadata !== undefined ? { metadata: metadata as Prisma.InputJsonValue } : {}),
      },
    });
    this.gateway.emitToProject(projectId, "activity:created", {
      log: log as unknown as Record<string, unknown>,
    });
    return log;
  }
}
