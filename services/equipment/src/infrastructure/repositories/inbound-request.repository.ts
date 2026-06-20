import { PrismaClient, Prisma, InboundRequest } from "@prisma/client";
import type { IInboundRequestRepository, InboundRequestWithItems } from "../../domain/repositories/inbound-request.repository.js";

/** IInboundRequestRepository 의 Prisma 구현 (infrastructure 계층). */
export class PrismaInboundRequestRepository implements IInboundRequestRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findById(id: string): Promise<InboundRequest | null> {
    return this.prisma.inboundRequest.findUnique({ where: { id } });
  }

  create(data: Prisma.InboundRequestUncheckedCreateInput): Promise<InboundRequestWithItems> {
    return this.prisma.inboundRequest.create({ data, include: { items: true } });
  }

  update(id: string, data: Prisma.InboundRequestUncheckedUpdateInput): Promise<InboundRequest> {
    return this.prisma.inboundRequest.update({ where: { id }, data });
  }
}
