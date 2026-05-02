// 보안 일괄패치 PDCA Layer 2 (NEW-4): JWT verify에 algorithms 명시
// jsonwebtoken/fastify-jwt가 알고리즘 confusion 공격 받지 않도록 HS256 강제

export const JWT_ALGORITHMS = ["HS256"] as const;

export type JwtPayload = {
  sub: string;       // user id
  email?: string;
  name?: string;
  role: "ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER";
  iat?: number;
  exp?: number;
};

// fastify-jwt request.jwtVerify에 전달
export const fastifyJwtVerifyOptions = {
  algorithms: [...JWT_ALGORITHMS],
};

// jsonwebtoken raw API용
export const jsonwebtokenVerifyOptions = {
  algorithms: [...JWT_ALGORITHMS],
};
