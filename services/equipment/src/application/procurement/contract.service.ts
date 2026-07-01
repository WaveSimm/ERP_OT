import { PrismaClient, ContractStatus } from "@prisma/client";
import type { IContractRepository } from "../../domain/repositories/contract.repository.js";

export class ContractService {
  // repo: Contract aggregate CRUD(Clean Arch). prisma: 복잡 read(list/getById include),
  //   계약번호 생성(read), finalize 중복검사, remove 가드.
  constructor(
    private readonly repo: IContractRepository,
    private readonly prisma: PrismaClient,
  ) {}

  async list(params: { search?: string; status?: ContractStatus; page?: number; limit?: number; sortBy?: string; sortOrder?: "asc" | "desc" } = {}) {
    const { search, status, page = 1, limit = 100, sortBy, sortOrder = "asc" } = params;
    const where: any = {};

    if (search) {
      where.OR = [
        { contractNumber: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
        { client: { contains: search, mode: "insensitive" } },
        { manufacturer: { contains: search, mode: "insensitive" } },
        { manager: { contains: search, mode: "insensitive" } },
      ];
    }
    if (status) where.status = status;

    // v1.6 (2026-05-13)
    const SORTABLE: Record<string, any> = {
      contractNumber: { contractNumber: sortOrder },
      name: { name: sortOrder },
      client: { client: sortOrder },
      manufacturer: { manufacturer: sortOrder },
      status: { status: sortOrder },
      startDate: { startDate: sortOrder },
      endDate: { endDate: sortOrder },
    };
    const orderBy = sortBy && SORTABLE[sortBy] ? SORTABLE[sortBy] : { contractNumber: "asc" };

    const [items, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        include: { _count: { select: { orders: true } } },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.contract.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async getById(id: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id },
      include: {
        orders: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true, orderNumber: true, manufacturer: true, currency: true,
            status: true, totalAmount: true, totalAmountKRW: true, orderDate: true,
            _count: { select: { items: true } },
          },
        },
      },
    });
    if (!contract) throw new Error("계약을 찾을 수 없습니다.");
    return contract;
  }

  async create(data: {
    contractNumber?: string;
    name: string;
    client: string;
    clientContact?: string;
    manufacturer?: string;
    category?: string;
    contractType?: string;
    contractDate?: string;
    deadline?: string;
    manager?: string;
    status?: ContractStatus;
    notes?: string;
    createdBy?: string;
  }) {
    const { contractDate, deadline, ...rest } = data;
    // v1.6.1 (2026-05-15): status에 따라 번호 자동 선택
    //   PROSPECTIVE  → TEMP-YYMM-NNN  (임시)
    //   ACTIVE/그 외 → #YY-NN          (정식)
    const status = rest.status ?? "PROSPECTIVE";
    let contractNumber = rest.contractNumber;
    if (!contractNumber) {
      contractNumber = status === "PROSPECTIVE"
        ? await this.generateTempNumber()
        : await this.generateNextNumber();
    }
    return this.repo.create({
      ...rest,
      status,
      contractNumber,
      ...(contractDate && { contractDate: new Date(contractDate) }),
      ...(deadline && { deadline: new Date(deadline) }),
    });
  }

  /**
   * v1.6.1 (2026-05-15): 계약 확정 — PROSPECTIVE → ACTIVE
   *   정식 contractNumber 입력 받음. 검증: TEMP- 아닌 형식.
   */
  async finalize(id: string, data: { contractNumber: string; contractDate?: string }) {
    const contract = await this.repo.findById(id);
    if (!contract) throw new Error("계약을 찾을 수 없습니다.");
    if (contract.status !== "PROSPECTIVE") {
      throw new Error(`계약 예정 상태에서만 확정할 수 있습니다. (현재: ${contract.status})`);
    }
    if (!data.contractNumber || data.contractNumber.startsWith("TEMP-")) {
      throw new Error("정식 계약번호를 입력해주세요.");
    }
    // unique 확인
    const dup = await this.prisma.contract.findUnique({ where: { contractNumber: data.contractNumber } });
    if (dup && dup.id !== id) {
      throw new Error(`이미 사용 중인 계약번호: ${data.contractNumber}`);
    }
    return this.repo.update(id, {
      status: "ACTIVE",
      contractNumber: data.contractNumber,
      ...(data.contractDate && { contractDate: new Date(data.contractDate) }),
    });
  }

  /** TEMP-YYMM-NNN 형식의 임시 계약번호 생성 (PROSPECTIVE 전용) */
  async generateTempNumber(): Promise<string> {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const prefix = `TEMP-${yy}${mm}-`;

    const last = await this.prisma.contract.findFirst({
      where: { contractNumber: { startsWith: prefix } },
      orderBy: { contractNumber: "desc" },
    });
    let seq = 1;
    if (last) {
      const m = last.contractNumber.match(/^TEMP-\d{4}-(\d+)$/);
      if (m && m[1]) seq = parseInt(m[1], 10) + 1;
    }
    return `${prefix}${String(seq).padStart(3, "0")}`;
  }

  async update(id: string, data: {
    contractNumber?: string;
    name?: string;
    client?: string;
    clientContact?: string;
    manufacturer?: string;
    category?: string;
    contractType?: string;
    contractDate?: string;
    deadline?: string;
    manager?: string;
    status?: ContractStatus;
    notes?: string;
  }) {
    await this.getById(id);
    const { contractDate, deadline, ...rest } = data;
    return this.repo.update(id, {
      ...rest,
      ...(contractDate !== undefined && { contractDate: contractDate ? new Date(contractDate) : null }),
      ...(deadline !== undefined && { deadline: deadline ? new Date(deadline) : null }),
    });
  }

  async remove(id: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id },
      include: { _count: { select: { orders: true } } },
    });
    if (!contract) throw new Error("계약을 찾을 수 없습니다.");
    if (contract._count.orders > 0) {
      throw new Error("발주가 있어 삭제할 수 없습니다.");
    }
    await this.repo.delete(id);
  }

  /** #YY-NN 형식의 다음 계약번호 생성 */
  async generateNextNumber(): Promise<string> {
    const yy = String(new Date().getFullYear()).slice(-2);
    const prefix = `#${yy}-`;

    const last = await this.prisma.contract.findFirst({
      where: { contractNumber: { startsWith: prefix } },
      orderBy: { contractNumber: "desc" },
    });

    let seq = 1;
    if (last) {
      const parts = last.contractNumber.split("-");
      seq = (parseInt(parts[1] ?? "0", 10) || 0) + 1;
    }
    return `${prefix}${String(seq).padStart(2, "0")}`;
  }

  // ─── 계약 마이그레이션 (엑셀 일괄 업로드) ─────────────────────────────────
  //  중복 판정 기준 = contractNumber (전 연도 통틀어 유니크, 원본 연번+연도에서 결정론적).
  //  재실행/이미 적재된 파일이어도 기존 건은 건너뛰고 신규만 적재 → 멱등.

  /** 유효 레코드: contractNumber + name 필수 */
  private static isValidImport(r: ContractImportRecord): boolean {
    return !!(r && r.contractNumber && String(r.contractNumber).trim() && r.name && String(r.name).trim());
  }

  /** 적재 전 미리보기 — 신규/중복(DB 기존)/오류 분류. 쓰기 없음. */
  async importPreview(records: ContractImportRecord[]) {
    const list = Array.isArray(records) ? records : [];
    const valid = list.filter((r) => ContractService.isValidImport(r));
    const invalid = list.filter((r) => !ContractService.isValidImport(r));

    const numbers = [...new Set(valid.map((r) => String(r.contractNumber).trim()))];
    const existing = numbers.length
      ? await this.prisma.contract.findMany({
          where: { contractNumber: { in: numbers } },
          select: { contractNumber: true },
        })
      : [];
    const existSet = new Set(existing.map((e) => e.contractNumber));

    const dup = valid.filter((r) => existSet.has(String(r.contractNumber).trim()));
    const fresh = valid.filter((r) => !existSet.has(String(r.contractNumber).trim()));

    return {
      total: list.length,
      newCount: fresh.length,
      duplicateCount: dup.length,
      invalidCount: invalid.length,
      sampleNew: fresh.slice(0, 50).map((r) => ({ contractNumber: r.contractNumber, name: r.name, client: r.client ?? "" })),
      sampleDuplicates: dup.slice(0, 50).map((r) => ({ contractNumber: r.contractNumber, name: r.name, client: r.client ?? "" })),
      sampleInvalid: invalid.slice(0, 50).map((r) => ({ contractNumber: r?.contractNumber ?? "", name: r?.name ?? "" })),
    };
  }

  /** 신규 건만 일괄 적재. DB 기존 + 파일 내 중복 번호 제거 후 createMany(skipDuplicates). */
  async importBulk(records: ContractImportRecord[], createdBy?: string) {
    const list = Array.isArray(records) ? records : [];
    const valid = list.filter((r) => ContractService.isValidImport(r));

    const numbers = [...new Set(valid.map((r) => String(r.contractNumber).trim()))];
    const existing = numbers.length
      ? await this.prisma.contract.findMany({
          where: { contractNumber: { in: numbers } },
          select: { contractNumber: true },
        })
      : [];
    const existSet = new Set(existing.map((e) => e.contractNumber));

    const seen = new Set<string>();
    const fresh: ContractImportRecord[] = [];
    for (const r of valid) {
      const cn = String(r.contractNumber).trim();
      if (existSet.has(cn) || seen.has(cn)) continue;
      seen.add(cn);
      fresh.push(r);
    }

    const str = (v: unknown, max: number) => (v == null || v === "" ? null : String(v).trim().slice(0, max));
    const toDate = (v: unknown) => {
      if (!v) return null;
      const d = new Date(String(v));
      return isNaN(d.getTime()) ? null : d;
    };

    const data = fresh.map((r) => ({
      contractNumber: String(r.contractNumber).trim(),
      name: String(r.name).trim().slice(0, 200),
      client: r.client ? String(r.client).trim().slice(0, 200) : "",
      clientContact: str(r.clientContact, 100),
      manufacturer: str(r.manufacturer, 200),
      category: r.category === "용역" ? "용역" : "물품",
      contractType: r.contractType === "외자" ? "외자" : "내자",
      contractDate: toDate(r.contractDate),
      deadline: toDate(r.deadline),
      manager: str(r.manager, 100),
      notes: str(r.notes, 500),
      status: "ACTIVE" as ContractStatus,
      createdBy: createdBy ?? "migration",
    }));

    const result = data.length
      ? await this.prisma.contract.createMany({ data, skipDuplicates: true })
      : { count: 0 };

    return {
      total: list.length,
      imported: result.count,
      duplicateInDb: valid.length - fresh.length, // DB 기존 + 파일 내 중복
      invalid: list.length - valid.length,
      skipped: list.length - result.count,
    };
  }
}

export type ContractImportRecord = {
  contractNumber?: string;
  name?: string;
  client?: string;
  clientContact?: string | null;
  manufacturer?: string | null;
  category?: string;
  contractType?: string;
  contractDate?: string | null;
  deadline?: string | null;
  manager?: string | null;
  notes?: string | null;
};
