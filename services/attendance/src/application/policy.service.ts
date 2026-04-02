import { PrismaClient } from "@prisma/client";

export class PolicyService {
  constructor(private readonly prisma: PrismaClient) {}

  async getPolicy() {
    const policy = await this.prisma.attendancePolicy.findFirst();
    if (!policy) {
      return this.prisma.attendancePolicy.create({
        data: { updatedBy: "system" },
      });
    }
    return policy;
  }

  async updatePolicy(data: {
    workStartTime?: string;
    workEndTime?: string;
    dailyWorkHours?: number;
    lateToleranceMinutes?: number;
    leavePolicy?: string;
    annualLeaveBase?: number;
    overtimeRates?: object;
    updatedBy: string;
  }) {
    const policy = await this.prisma.attendancePolicy.findFirst();
    if (!policy) {
      return this.prisma.attendancePolicy.create({ data: data as any });
    }
    return this.prisma.attendancePolicy.update({ where: { id: policy.id }, data });
  }

  async getHolidays(year: number) {
    return this.prisma.publicHoliday.findMany({
      where: { year },
      orderBy: { date: "asc" },
    });
  }

  async createHoliday(date: string, name: string) {
    const d = new Date(date);
    return this.prisma.publicHoliday.create({
      data: { date: d, name, year: d.getFullYear() },
    });
  }

  async deleteHoliday(id: string) {
    return this.prisma.publicHoliday.delete({ where: { id } });
  }
}
