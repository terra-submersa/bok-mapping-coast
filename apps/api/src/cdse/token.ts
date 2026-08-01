import type { CdseCredentials } from "../config.js";

const TOKEN_URL =
  "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";

/**
 * Renew this long before the token actually expires. A composite request can take
 * tens of seconds, so a token that is valid at request time but expires mid-flight
 * would fail the whole (metered) call.
 */
const EXPIRY_MARGIN_MS = 60_000;

export interface TokenSource {
  getAccessToken(): Promise<string>;
}

export interface TokenSourceOptions {
  fetchFn?: typeof fetch;
  now?: () => number;
}

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

/**
 * Caches a CDSE access token in memory until it is close to expiry, and collapses
 * concurrent misses onto a single token request.
 */
export function createTokenSource(
  credentials: CdseCredentials,
  { fetchFn = fetch, now = Date.now }: TokenSourceOptions = {},
): TokenSource {
  let cached: CachedToken | null = null;
  let inFlight: Promise<CachedToken> | null = null;

  async function requestToken(): Promise<CachedToken> {
    const res = await fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      }),
    });
    if (!res.ok) {
      // Deliberately does not echo the response body — it can contain the client_id.
      throw new Error(`CDSE token request failed: ${res.status} ${res.statusText}`);
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) {
      throw new Error("CDSE token response contained no access_token.");
    }
    const lifetimeMs = (json.expires_in ?? 600) * 1000;
    return { accessToken: json.access_token, expiresAtMs: now() + lifetimeMs };
  }

  return {
    async getAccessToken() {
      if (cached && now() < cached.expiresAtMs - EXPIRY_MARGIN_MS) {
        return cached.accessToken;
      }
      if (!inFlight) {
        inFlight = requestToken().finally(() => {
          inFlight = null;
        });
      }
      cached = await inFlight;
      return cached.accessToken;
    },
  };
}
