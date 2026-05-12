// auth-service 사용자 프로필 조회 (부서명 등)
// /internal/users/:id/profile

export interface UserProfileResp {
  id: string;
  name: string;
  email: string;
  role: string;
  profile?: {
    departmentName: string | null;
    position: string | null;
  } | null;
}

export class AuthClient {
  private cache = new Map<string, { value: UserProfileResp; expiresAt: number }>();
  private readonly TTL_MS = 60_000;

  constructor(
    private readonly authServiceUrl: string,
    private readonly internalToken: string,
  ) {}

  async getUserProfile(userId: string): Promise<UserProfileResp | null> {
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    try {
      const res = await fetch(`${this.authServiceUrl}/internal/users/${userId}/profile`, {
        headers: { "X-Internal-Token": this.internalToken },
      });
      if (!res.ok) return null;
      const value = (await res.json()) as UserProfileResp;
      this.cache.set(userId, { value, expiresAt: Date.now() + this.TTL_MS });
      return value;
    } catch {
      return null;
    }
  }

  async isFinanceTeam(userId: string): Promise<boolean> {
    const u = await this.getUserProfile(userId);
    if (!u) return false;
    if (u.role === "ADMIN") return true;
    return (u.profile?.departmentName ?? "").trim() === "재무팀";
  }
}
