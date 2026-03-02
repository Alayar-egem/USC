import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, ApiError, SESSION_EXPIRED_EVENT } from "./client";

describe("api client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refreshes token on first 401 and retries request", async () => {
    localStorage.setItem("usc_access_token", "old-access");
    localStorage.setItem("usc_refresh_token", "old-refresh");

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access: "new-access", refresh: "new-refresh" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

    vi.stubGlobal("fetch", fetchMock);

    const result = await api<{ ok: boolean }>("/orders/", { auth: true });

    expect(result.ok).toBe(true);
    expect(localStorage.getItem("usc_access_token")).toBe("new-access");
    expect(localStorage.getItem("usc_refresh_token")).toBe("new-refresh");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws ApiError and emits session-expired after failed refresh", async () => {
    localStorage.setItem("usc_access_token", "old-access");
    localStorage.setItem("usc_refresh_token", "old-refresh");

    const events: Event[] = [];
    const handler = (ev: Event) => events.push(ev);
    window.addEventListener(SESSION_EXPIRED_EVENT, handler);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(new Response("refresh-failed", { status: 401 }));

    vi.stubGlobal("fetch", fetchMock);

    let caught: unknown;
    try {
      await api("/profile/me/", { auth: true });
    } catch (error) {
      caught = error;
    }

    window.removeEventListener(SESSION_EXPIRED_EVENT, handler);
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(401);
    expect(events.length).toBeGreaterThan(0);
  });

  it("uses single refresh request for concurrent 401 responses", async () => {
    localStorage.setItem("usc_access_token", "old-access");
    localStorage.setItem("usc_refresh_token", "old-refresh");

    let protectedCalls = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/orders/") || url.endsWith("/profile/me/")) {
        protectedCalls += 1;
        if (protectedCalls <= 2) {
          return Promise.resolve(new Response("unauthorized", { status: 401 }));
        }
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      if (url.endsWith("/auth/token/refresh/")) {
        return Promise.resolve(
          new Response(JSON.stringify({ access: "new-access", refresh: "new-refresh" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      return Promise.resolve(new Response("not-found", { status: 404 }));
    });

    vi.stubGlobal("fetch", fetchMock);

    const [a, b] = await Promise.all([
      api<{ ok: boolean }>("/orders/", { auth: true }),
      api<{ ok: boolean }>("/profile/me/", { auth: true }),
    ]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    const refreshCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/auth/token/refresh/")
    );
    expect(refreshCalls).toHaveLength(1);
  });
});
