import Redis from "ioredis";

export interface ApproverInfo {
  userId: string;
  approverId: string;
  approverName: string | null;
  approverEmail: string | null;
  secondApproverId: string | null;
  secondApproverName: string | null;
  thirdApproverId: string | null;
  thirdApproverName: string | null;
  delegateId: string | null;
  delegateUntil: string | null;
  isDelegated: boolean;
}

export class AuthClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly redis: Redis,
  ) {}

  private async get<T>(path: string, cacheKey: string, ttl = 300): Promise<T | null> {
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as T;

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        headers: { "X-Internal-Token": this.token },
      });
      if (!res.ok) return null;
      const data = await res.json() as T;
      await this.redis.set(cacheKey, JSON.stringify(data), "EX", ttl);
      return data;
    } catch {
      return null;
    }
  }

  async getApprover(userId: string): Promise<ApproverInfo | null> {
    return this.get<ApproverInfo>(
      `/internal/users/${userId}/approver`,
      `approver:${userId}`,
    );
  }

  async getSubordinates(approverId: string): Promise<string[]> {
    const result = await this.get<string[]>(
      `/internal/approver/${approverId}/subordinates`,
      `subordinates:${approverId}`,
    );
    return result ?? [];
  }

  async bulkGetUsers(ids: string[]): Promise<Record<string, { name: string; email: string }>> {
    if (ids.length === 0) return {};
    const sorted = [...ids].sort();
    const cacheKey = `bulk_users:${sorted.join(",")}`;
    const result = await this.get<Record<string, { name: string; email: string }>>(
      `/internal/users/bulk?ids=${ids.join(",")}`,
      cacheKey,
      60, // 1분 캐시 (사용자 이름은 자주 바뀌지 않음)
    );
    return result ?? {};
  }

  // 캐시 무효화 (결재라인 변경 시 호출)
  async invalidateApprover(userId: string) {
    await this.redis.del(`approver:${userId}`);
  }
}
