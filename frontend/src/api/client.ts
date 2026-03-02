import { API_BASE } from "../config";

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";
export const SESSION_EXPIRED_EVENT = "usc:session-expired";

let lastSessionExpiredEventAt = 0;
let refreshInFlight: Promise<string | null> | null = null;
const ACCESS_REFRESH_SKEW_SECONDS = 20;

export class ApiError extends Error {
  status: number;
  method: HttpMethod;
  path: string;
  detail: string;

  constructor(status: number, method: HttpMethod, path: string, detail: string) {
    super(`API ${method} ${path} -> ${status}: ${detail}`);
    this.name = "ApiError";
    this.status = status;
    this.method = method;
    this.path = path;
    this.detail = detail;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

function getToken(): string | null {
  return localStorage.getItem("usc_access_token");
}

function readJwtExp(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { exp?: unknown };
    const exp = Number(payload?.exp);
    return Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
}

function isTokenExpiredOrNear(token: string): boolean {
  const exp = readJwtExp(token);
  if (!exp) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  return exp <= nowSec + ACCESS_REFRESH_SKEW_SECONDS;
}

export function forceLogout(reason: "missing-token" | "unauthorized" = "unauthorized") {
  localStorage.removeItem("usc_access_token");
  localStorage.removeItem("usc_refresh_token");
  emitSessionExpired(reason);
}

async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  const refresh = localStorage.getItem("usc_refresh_token");
  if (!refresh) return null;

  refreshInFlight = (async () => {
    const res = await fetch(`${API_BASE}/auth/token/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access?: string; refresh?: string };
    if (!data?.access) return null;
    localStorage.setItem("usc_access_token", data.access);
    if (data.refresh) localStorage.setItem("usc_refresh_token", data.refresh);
    return data.access;
  })()
    .catch(() => null)
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}

function emitSessionExpired(reason: "missing-token" | "unauthorized") {
  const now = Date.now();
  if (now - lastSessionExpiredEventAt < 400) return;
  lastSessionExpiredEventAt = now;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { reason } }));
  }
}

export async function api<T>(
  path: string,
  opts?: {
    method?: HttpMethod;
    body?: unknown;
    auth?: boolean;
    headers?: Record<string, string>;
  }
): Promise<T> {
  return apiInternal<T>(path, opts, false);
}

async function apiInternal<T>(
  path: string,
  opts:
    | {
        method?: HttpMethod;
        body?: unknown;
        auth?: boolean;
        headers?: Record<string, string>;
      }
    | undefined,
  retried: boolean
): Promise<T> {
  const method = opts?.method ?? "GET";
  const auth = opts?.auth ?? false;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts?.headers ?? {}),
  };

  if (auth) {
    let token = getToken();

    if (token && isTokenExpiredOrNear(token)) {
      const refreshed = await refreshAccessToken();
      token = refreshed || getToken();
    }

    if (!token) {
      const refreshed = await refreshAccessToken();
      token = refreshed || getToken();
    }

    if (!token) {
      forceLogout("missing-token");
      throw new ApiError(401, method, path, "Missing access token");
    }
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    if (auth && res.status === 401 && !retried) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        return apiInternal<T>(path, opts, true);
      }
    }
    if (auth && res.status === 401) {
      forceLogout("unauthorized");
    }
    const text = await res.text().catch(() => "");
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { detail?: unknown };
      if (typeof parsed?.detail === "string") detail = parsed.detail;
      else if (parsed?.detail) detail = JSON.stringify(parsed.detail);
    } catch {
      // keep raw response text
    }
    throw new ApiError(res.status, method, path, detail);
  }

  // если пустой ответ
  if (res.status === 204) return undefined as T;

  return (await res.json()) as T;
}
