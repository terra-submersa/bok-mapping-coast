import { describe, expect, it, vi } from "vitest";
import { createTokenSource } from "./token.js";

const CREDENTIALS = { clientId: "id", clientSecret: "secret" };

function tokenResponse(accessToken: string, expiresIn = 600) {
  return new Response(JSON.stringify({ access_token: accessToken, expires_in: expiresIn }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createTokenSource", () => {
  it("fetches a token on first use", async () => {
    const fetchFn = vi.fn().mockResolvedValue(tokenResponse("tok-1"));
    const tokens = createTokenSource(CREDENTIALS, { fetchFn });
    expect(await tokens.getAccessToken()).toBe("tok-1");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("reuses a cached token while it is still comfortably valid", async () => {
    const fetchFn = vi.fn().mockResolvedValue(tokenResponse("tok-1", 600));
    let now = 0;
    const tokens = createTokenSource(CREDENTIALS, { fetchFn, now: () => now });

    await tokens.getAccessToken();
    now = 300_000;
    expect(await tokens.getAccessToken()).toBe("tok-1");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("renews before expiry, so a slow composite cannot outlive its token", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse("tok-1", 600))
      .mockResolvedValueOnce(tokenResponse("tok-2", 600));
    let now = 0;
    const tokens = createTokenSource(CREDENTIALS, { fetchFn, now: () => now });

    await tokens.getAccessToken();
    // 30 s before the nominal expiry — inside the 60 s safety margin.
    now = 570_000;
    expect(await tokens.getAccessToken()).toBe("tok-2");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("collapses concurrent misses onto one token request", async () => {
    const fetchFn = vi.fn().mockResolvedValue(tokenResponse("tok-1"));
    const tokens = createTokenSource(CREDENTIALS, { fetchFn });

    const results = await Promise.all([
      tokens.getAccessToken(),
      tokens.getAccessToken(),
      tokens.getAccessToken(),
    ]);

    expect(results).toEqual(["tok-1", "tok-1", "tok-1"]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("throws without leaking the request body on a rejected token request", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response("nope", { status: 401, statusText: "Unauthorized" }));
    const tokens = createTokenSource(CREDENTIALS, { fetchFn });

    await expect(tokens.getAccessToken()).rejects.toThrow(/401 Unauthorized/);
    await expect(tokens.getAccessToken()).rejects.not.toThrow(/secret/);
  });

  it("retries after a failure rather than caching the rejection", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 500, statusText: "Server Error" }))
      .mockResolvedValueOnce(tokenResponse("tok-1"));
    const tokens = createTokenSource(CREDENTIALS, { fetchFn });

    await expect(tokens.getAccessToken()).rejects.toThrow();
    expect(await tokens.getAccessToken()).toBe("tok-1");
  });
});
