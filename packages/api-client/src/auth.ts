import { apiRequest } from "./client";

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  user: {
    id: string;
    email: string;
    role: string;
  };
}

export const authApi = {
  login: (data: LoginRequest) =>
    apiRequest<LoginResponse>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  logout: () =>
    apiRequest<void>("/api/v1/auth/logout", { method: "POST" }),

  refresh: () =>
    apiRequest<{ accessToken: string }>("/api/v1/auth/refresh", {
      method: "POST",
    }),
};
