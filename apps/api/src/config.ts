export interface CdseCredentials {
  clientId: string;
  clientSecret: string;
}

/** Reads CDSE OAuth credentials from the environment. Secrets live here and nowhere else. */
export function readCdseCredentials(env: NodeJS.ProcessEnv = process.env): CdseCredentials {
  const clientId = env.CDSE_OAUTH_CLIENT_ID;
  const clientSecret = env.CDSE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing CDSE_OAUTH_CLIENT_ID / CDSE_OAUTH_CLIENT_SECRET. " +
        "Copy apps/api/.env.example to apps/api/.env and fill in your Copernicus credentials.",
    );
  }
  return { clientId, clientSecret };
}

/** Directory for cached Processing API responses. Gitignored; safe to delete, expensive to refill. */
export function readCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.COMPOSITE_CACHE_DIR ?? ".cache/composites";
}

/**
 * SQLite file holding named projects (issue #8). Unlike the composite cache this is
 * *not* safe to delete — it is the only copy of the AOI and the hand-drawn zones a
 * Planner has built up. Gitignored, since it is a working file rather than source.
 */
export function readProjectDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.PROJECT_DB_PATH ?? ".cache/projects.sqlite";
}
