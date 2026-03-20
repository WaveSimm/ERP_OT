import { Redis } from "ioredis";

const KEYS = {
  projectSummary: (id: string) => `dashboard:project:${id}:summary`,
  groupRollup: (id: string) => `dashboard:group:${id}:rollup`,
  globalSummary: () => `dashboard:global:summary`,
  resourceUtilization: (id: string, start: string, end: string) =>
    `resource:utilization:${id}:${start}:${end}`,
  cpmResult: (id: string) => `cpm:result:${id}`,
};

const TTL = {
  projectSummary: 300, // 5분
  groupRollup: 300,
  globalSummary: 300,
  resourceUtilization: 60, // 1분
  cpmResult: 86400, // 24시간 (변경 시 명시적 무효화)
};

export class ProjectCacheService {
  constructor(private readonly redis: Redis) {}

  async getProjectSummary<T>(projectId: string): Promise<T | null> {
    const data = await this.redis.get(KEYS.projectSummary(projectId));
    return data ? (JSON.parse(data) as T) : null;
  }

  async setProjectSummary<T>(projectId: string, data: T): Promise<void> {
    await this.redis.setex(
      KEYS.projectSummary(projectId),
      TTL.projectSummary,
      JSON.stringify(data),
    );
  }

  async getCpmResult<T>(projectId: string): Promise<T | null> {
    const data = await this.redis.get(KEYS.cpmResult(projectId));
    return data ? (JSON.parse(data) as T) : null;
  }

  async setCpmResult<T>(projectId: string, data: T): Promise<void> {
    await this.redis.setex(KEYS.cpmResult(projectId), TTL.cpmResult, JSON.stringify(data));
  }

  async invalidateCpmResult(projectId: string): Promise<void> {
    await this.redis.del(KEYS.cpmResult(projectId));
  }

  async invalidateProjectSummary(projectId: string): Promise<void> {
    await this.redis.del(KEYS.projectSummary(projectId));
    await this.redis.del(KEYS.globalSummary());
  }

  async getGroupRollup<T>(groupId: string): Promise<T | null> {
    const data = await this.redis.get(KEYS.groupRollup(groupId));
    return data ? (JSON.parse(data) as T) : null;
  }

  async setGroupRollup<T>(groupId: string, data: T): Promise<void> {
    await this.redis.setex(KEYS.groupRollup(groupId), TTL.groupRollup, JSON.stringify(data));
  }

  async invalidateGroupRollup(groupId: string): Promise<void> {
    await this.redis.del(KEYS.groupRollup(groupId));
  }

  async getResourceUtilization<T>(
    resourceId: string,
    start: string,
    end: string,
  ): Promise<T | null> {
    const data = await this.redis.get(KEYS.resourceUtilization(resourceId, start, end));
    return data ? (JSON.parse(data) as T) : null;
  }

  async setResourceUtilization<T>(
    resourceId: string,
    start: string,
    end: string,
    data: T,
  ): Promise<void> {
    await this.redis.setex(
      KEYS.resourceUtilization(resourceId, start, end),
      TTL.resourceUtilization,
      JSON.stringify(data),
    );
  }

  async acquireRefreshLock(ttlSeconds = 60): Promise<boolean> {
    const result = await this.redis.set("dashboard:refresh:lock", "1", "EX", ttlSeconds, "NX");
    return result === "OK";
  }

  async releaseRefreshLock(): Promise<void> {
    await this.redis.del("dashboard:refresh:lock");
  }
}
