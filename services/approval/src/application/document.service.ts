import { PrismaClient, ApprovalDocumentStatus } from "@prisma/client";
import {
  assertTransition,
  getAllowedTransitions,
  getNextStepStatus,
  getCurrentStepOrder,
} from "../domain/state-machine/approval.fsm.js";

export class DocumentService {
  constructor(private prisma: PrismaClient) {}

  // ─── Document CRUD ──────────────────────────────────────────────────

  async create(data: {
    templateId: string;
    title: string;
    requestedBy: string;
    requesterName?: string;
    department: string;
    approvalStepCount: number;
    content?: any;
    richBody?: string;
    itemsData?: any;
    itemsTotal?: number;
    amount?: number;
    referenceType?: string;
    referenceId?: string;
    ccUsers?: string[];
    agreementUsers?: string[];
    referenceDepts?: string[];
    referencePersons?: string[];
    notes?: string;
    steps: Array<{ stepOrder: number; roleName: string; approverId: string; approverName: string }>;
  }) {
    const { steps, ...rest } = data;
    const docNumber = await this.generateDocNumber(data.templateId);

    return this.prisma.approvalDocument.create({
      data: {
        ...rest,
        documentNumber: docNumber,
        status: "DRAFT",
        steps: { create: steps },
      } as any,
      include: { steps: true, template: { select: { code: true, name: true } } },
    });
  }

  async getById(id: string) {
    const doc = await this.prisma.approvalDocument.findUnique({
      where: { id },
      include: {
        template: true,
        steps: { orderBy: { stepOrder: "asc" } },
        attachments: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!doc) throw new Error("결재 문서를 찾을 수 없습니다.");

    // requesterName이 없으면 auth-service에서 조회 후 저장
    let requesterName = doc.requesterName;
    if (!requesterName && doc.requestedBy) {
      requesterName = await this.resolveUserName(doc.requestedBy);
      if (requesterName) {
        await this.prisma.approvalDocument.update({
          where: { id },
          data: { requesterName },
        });
      }
    }

    return { ...doc, requesterName, allowedTransitions: getAllowedTransitions(doc.status) };
  }

  async getByReference(referenceType: string, referenceId: string) {
    return this.prisma.approvalDocument.findFirst({
      where: { referenceType, referenceId },
      include: {
        template: { select: { code: true, name: true } },
        steps: { orderBy: { stepOrder: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async update(id: string, data: any) {
    const doc = await this.prisma.approvalDocument.findUnique({ where: { id } });
    if (!doc) throw new Error("결재 문서를 찾을 수 없습니다.");
    if (doc.status !== "DRAFT" && doc.status !== "RETURNED" && doc.status !== "REJECTED") {
      throw new Error("초안/반환/반려 상태에서만 수정할 수 있습니다.");
    }
    return this.prisma.approvalDocument.update({ where: { id }, data });
  }

  async remove(id: string) {
    const doc = await this.prisma.approvalDocument.findUnique({ where: { id } });
    if (!doc) throw new Error("결재 문서를 찾을 수 없습니다.");
    if (doc.status !== "DRAFT") throw new Error("초안 상태에서만 삭제할 수 있습니다.");
    return this.prisma.approvalDocument.delete({ where: { id } });
  }

  // ─── Submit (상신) ──────────────────────────────────────────────────

  async submit(id: string) {
    const doc = await this.prisma.approvalDocument.findUnique({
      where: { id },
      include: { steps: true },
    });
    if (!doc) throw new Error("결재 문서를 찾을 수 없습니다.");

    const hasAgreement = doc.agreementUsers.length > 0;
    const nextStatus: ApprovalDocumentStatus = hasAgreement ? "AGREEMENT_PENDING" : "STEP_1_PENDING";

    assertTransition(doc.status, hasAgreement ? "AGREEMENT_PENDING" : "SUBMITTED");

    return this.prisma.approvalDocument.update({
      where: { id },
      data: {
        status: nextStatus,
        submittedAt: new Date(),
      },
      include: { steps: true },
    });
  }

  // ─── Approve (승인) ─────────────────────────────────────────────────

  async approve(id: string, approverId: string, comment?: string) {
    const doc = await this.prisma.approvalDocument.findUnique({
      where: { id },
      include: { steps: { orderBy: { stepOrder: "asc" } }, template: true },
    });
    if (!doc) throw new Error("결재 문서를 찾을 수 없습니다.");

    const currentOrder = getCurrentStepOrder(doc.status);
    if (currentOrder === null) throw new Error("현재 결재 대기 상태가 아닙니다.");

    const step = doc.steps.find((s) => s.stepOrder === currentOrder);
    if (!step) throw new Error("결재 단계를 찾을 수 없습니다.");
    if (step.approverId !== approverId) throw new Error("결재 권한이 없습니다.");

    const nextStatus = getNextStepStatus(doc.status, doc.approvalStepCount);
    const isFinished = nextStatus === "APPROVED";

    return this.prisma.$transaction(async (tx) => {
      await tx.approvalStep.update({
        where: { id: step.id },
        data: { status: "APPROVED", comment: comment ?? null, actedAt: new Date() },
      });

      const updated = await tx.approvalDocument.update({
        where: { id },
        data: {
          status: nextStatus,
          ...(isFinished && { completedAt: new Date() }),
        },
        include: { steps: true, template: true },
      });

      // Post-approval action
      if (isFinished && doc.template.postApprovalAction) {
        await this.executePostAction(doc.template.postApprovalAction, doc);
      }

      return updated;
    });
  }

  // ─── Reject (반려) ──────────────────────────────────────────────────

  async reject(id: string, approverId: string, comment: string) {
    const doc = await this.prisma.approvalDocument.findUnique({
      where: { id },
      include: { steps: { orderBy: { stepOrder: "asc" } } },
    });
    if (!doc) throw new Error("결재 문서를 찾을 수 없습니다.");

    const currentOrder = getCurrentStepOrder(doc.status);
    if (currentOrder === null) throw new Error("현재 결재 대기 상태가 아닙니다.");

    const step = doc.steps.find((s) => s.stepOrder === currentOrder);
    if (!step) throw new Error("결재 단계를 찾을 수 없습니다.");
    if (step.approverId !== approverId) throw new Error("결재 권한이 없습니다.");

    return this.prisma.$transaction(async (tx) => {
      await tx.approvalStep.update({
        where: { id: step.id },
        data: { status: "REJECTED", comment, actedAt: new Date() },
      });

      const updated = await tx.approvalDocument.update({
        where: { id },
        data: { status: "REJECTED", completedAt: new Date() },
        include: { steps: true, template: true },
      });

      // Post-reject action (leave/overtime)
      if (doc.referenceId && updated.template) {
        const postAction = (updated.template as any).postApprovalAction;
        if (postAction === "LEAVE_APPROVE" || postAction === "OT_APPROVE") {
          await this.executePostReject(postAction, doc, comment);
        }
      }

      return updated;
    });
  }

  // ─── Withdraw (상신 취소) ────────────────────────────────────────────

  async withdraw(id: string, requesterId: string) {
    const doc = await this.prisma.approvalDocument.findUnique({
      where: { id },
      include: { steps: true },
    });
    if (!doc) throw new Error("결재 문서를 찾을 수 없습니다.");
    if (doc.requestedBy !== requesterId) throw new Error("기안자만 상신을 취소할 수 있습니다.");

    assertTransition(doc.status, "DRAFT");

    return this.prisma.$transaction(async (tx) => {
      // 결재 단계 초기화
      if (doc.steps.length > 0) {
        await tx.approvalStep.updateMany({
          where: { documentId: id },
          data: { status: "PENDING", comment: null, actedAt: null },
        });
      }

      return tx.approvalDocument.update({
        where: { id },
        data: { status: "DRAFT", submittedAt: null },
        include: { steps: true },
      });
    });
  }

  // ─── Agreement (합의) ───────────────────────────────────────────────

  async agree(id: string, userId: string) {
    // Simplified: just move to SUBMITTED when agreed
    const doc = await this.prisma.approvalDocument.findUnique({ where: { id } });
    if (!doc) throw new Error("결재 문서를 찾을 수 없습니다.");
    if (doc.status !== "AGREEMENT_PENDING") throw new Error("합의 대기 상태가 아닙니다.");
    if (!doc.agreementUsers.includes(userId)) throw new Error("합의 권한이 없습니다.");

    return this.prisma.approvalDocument.update({
      where: { id },
      data: { status: "STEP_1_PENDING" },
    });
  }

  async disagree(id: string, userId: string, comment: string) {
    const doc = await this.prisma.approvalDocument.findUnique({ where: { id } });
    if (!doc) throw new Error("결재 문서를 찾을 수 없습니다.");
    if (doc.status !== "AGREEMENT_PENDING") throw new Error("합의 대기 상태가 아닙니다.");

    return this.prisma.approvalDocument.update({
      where: { id },
      data: { status: "RETURNED" },
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  /** 목록 조회 시 requesterName이 없는 문서에 이름 채워넣기 */
  private async fillRequesterNames(items: any[]): Promise<any[]> {
    const needFill = items.filter((d) => !d.requesterName && d.requestedBy);
    if (needFill.length === 0) return items;

    const uniqueIds = [...new Set(needFill.map((d) => d.requestedBy))];
    const nameMap: Record<string, string> = {};
    for (const uid of uniqueIds) {
      const name = await this.resolveUserName(uid);
      if (name) {
        nameMap[uid] = name;
        // DB에도 저장 (다음부터는 조회 불필요)
        await this.prisma.approvalDocument.updateMany({
          where: { requestedBy: uid, requesterName: null },
          data: { requesterName: name },
        });
      }
    }
    return items.map((d) => d.requesterName ? d : { ...d, requesterName: nameMap[d.requestedBy] || null });
  }

  // ─── Inbox queries ──────────────────────────────────────────────────

  async getPending(userId: string, page = 1, limit = 50) {
    const where = {
      steps: { some: { approverId: userId, status: "PENDING" as const } },
      status: { in: ["STEP_1_PENDING", "STEP_2_PENDING", "STEP_3_PENDING"] as ApprovalDocumentStatus[] },
    };
    const [items, total] = await Promise.all([
      this.prisma.approvalDocument.findMany({
        where,
        include: {
          template: { select: { code: true, name: true, category: true } },
          steps: { orderBy: { stepOrder: "asc" as const } },
        },
        orderBy: { submittedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.approvalDocument.count({ where }),
    ]);
    return { items: await this.fillRequesterNames(items), total, page, limit };
  }

  async getPendingCount(userId: string): Promise<number> {
    return this.prisma.approvalDocument.count({
      where: {
        steps: { some: { approverId: userId, status: "PENDING" } },
        status: { in: ["STEP_1_PENDING", "STEP_2_PENDING", "STEP_3_PENDING"] },
      },
    });
  }

  async getSent(userId: string, page = 1, limit = 50) {
    const where = { requestedBy: userId };
    const [items, total] = await Promise.all([
      this.prisma.approvalDocument.findMany({
        where,
        include: {
          template: { select: { code: true, name: true } },
          steps: { orderBy: { stepOrder: "asc" as const } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.approvalDocument.count({ where }),
    ]);
    return { items: await this.fillRequesterNames(items), total, page, limit };
  }

  async getCC(userId: string, page = 1, limit = 50) {
    const where = {
      OR: [
        { ccUsers: { has: userId } },
        { referencePersons: { has: userId } },
      ],
    };
    const [items, total] = await Promise.all([
      this.prisma.approvalDocument.findMany({
        where,
        include: { template: { select: { code: true, name: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.approvalDocument.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async getCompleted(userId: string, page = 1, limit = 50) {
    const where = {
      steps: { some: { approverId: userId, status: { in: ["APPROVED" as const, "REJECTED" as const] } } },
    };
    const [items, total] = await Promise.all([
      this.prisma.approvalDocument.findMany({
        where,
        include: {
          template: { select: { code: true, name: true } },
          steps: { orderBy: { stepOrder: "asc" as const } },
        },
        orderBy: { completedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.approvalDocument.count({ where }),
    ]);
    return { items: await this.fillRequesterNames(items), total, page, limit };
  }

  // ─── Private ────────────────────────────────────────────────────────

  private async resolveUserName(userId: string): Promise<string | null> {
    try {
      const authUrl = process.env.AUTH_SERVICE_URL || "http://auth-service:3001";
      // 보안 일괄패치 PDCA Layer 1 (C3): startup-time Zod env 검증으로 보장
    const token = process.env.INTERNAL_API_TOKEN as string;
      const resp = await fetch(`${authUrl}/internal/users/${userId}/profile`, {
        headers: { "X-Internal-Token": token },
      });
      if (resp.ok) {
        const user = await resp.json() as any;
        return user.name || user.profile?.name || null;
      }
    } catch { /* ignore */ }
    return null;
  }

  private async generateDocNumber(templateId: string): Promise<string> {
    const template = await this.prisma.approvalTemplate.findUnique({ where: { id: templateId } });
    const prefix = template?.code || "DOC";
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const yearMonth = `${yyyy}${mm}`;
    const count = await this.prisma.approvalDocument.count({
      where: { documentNumber: { startsWith: `OT-${prefix}-${yearMonth}` } },
    });
    return `OT-${prefix}-${yearMonth}${dd}-${String(count + 1).padStart(4, "0")}`;
  }

  private async executePostReject(action: string, doc: any, comment: string): Promise<void> {
    const attendanceUrl = process.env.ATTENDANCE_SERVICE_URL || "http://attendance-service:3004";
    // 보안 일괄패치 PDCA Layer 1 (C3): startup-time Zod env 검증으로 보장
    const token = process.env.INTERNAL_API_TOKEN as string;
    try {
      const endpoint = action === "LEAVE_APPROVE"
        ? `${attendanceUrl}/internal/leave/${doc.referenceId}/framework-approve`
        : `${attendanceUrl}/internal/overtime/${doc.referenceId}/framework-approve`;
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Internal-Token": token },
        body: JSON.stringify({ approverId: doc.requestedBy, action: "REJECT", rejectReason: comment }),
      });
    } catch (err) {
      // TODO: inject logger — DocumentService에 FastifyBaseLogger 주입 후 this.log.error로 교체
      console.error(`Post-reject action failed: ${action}`, err); // eslint-disable-line no-console
    }
  }

  private async executePostAction(action: string, doc: any): Promise<void> {
    const equipmentUrl = process.env.EQUIPMENT_SERVICE_URL || "http://equipment-service:3005";
    const attendanceUrl = process.env.ATTENDANCE_SERVICE_URL || "http://attendance-service:3004";
    // 보안 일괄패치 PDCA Layer 1 (C3): startup-time Zod env 검증으로 보장
    const token = process.env.INTERNAL_API_TOKEN as string;

    try {
      switch (action) {
        case "ORDER_CONFIRM":
          if (doc.referenceId) {
            await fetch(`${equipmentUrl}/internal/orders/${doc.referenceId}/confirm`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-Internal-Token": token },
              body: JSON.stringify({ documentId: doc.id }),
            });
          }
          break;
        case "FINANCE_FORWARD":
          await fetch(`${equipmentUrl}/internal/expenses/follow-up`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Internal-Token": token },
            body: JSON.stringify({ approvalDocumentId: doc.id }),
          });
          break;
        case "LEAVE_APPROVE":
          if (doc.referenceId) {
            await fetch(`${attendanceUrl}/internal/leave/${doc.referenceId}/framework-approve`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-Internal-Token": token },
              body: JSON.stringify({ approverId: doc.requestedBy, action: "APPROVE" }),
            });
          }
          break;
        case "OT_APPROVE":
          if (doc.referenceId) {
            await fetch(`${attendanceUrl}/internal/overtime/${doc.referenceId}/framework-approve`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-Internal-Token": token },
              body: JSON.stringify({ approverId: doc.requestedBy, action: "APPROVE" }),
            });
          }
          break;
      }
    } catch (err) {
      // TODO: inject logger — DocumentService에 FastifyBaseLogger 주입 후 this.log.error로 교체
      console.error(`Post-approval action failed: ${action}`, err); // eslint-disable-line no-console
    }
  }
}
