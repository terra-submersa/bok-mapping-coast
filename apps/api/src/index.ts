import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createCompositeCache } from "./cache.js";
import { createProcessClient } from "./cdse/process.js";
import { createTokenSource } from "./cdse/token.js";
import { type CompositeService, createCompositeService } from "./composite.js";
import { readCacheDir, readCdseCredentials, readProjectDbPath } from "./config.js";
import { createProjectStore, type ProjectStore } from "./projects/store.js";
import { createCompositeRoutes } from "./routes/composite.js";
import { createProjectRoutes } from "./routes/projects.js";

const app = new Hono();

// The web app runs on a different port in dev; it only ever reads from this API.
app.use("/api/*", cors());

app.get("/health", (c) => c.json({ status: "ok" }));

/**
 * Built on first use rather than at import, so a clone without apps/api/.env still
 * starts and answers /health — you get a 502 explaining the missing credentials
 * when you actually ask for a composite, instead of a server that won't boot.
 */
let service: CompositeService | undefined;
function getService(): CompositeService {
  if (!service) {
    service = createCompositeService(
      createCompositeCache(readCacheDir()),
      createProcessClient(createTokenSource(readCdseCredentials())),
    );
  }
  return service;
}

/** Opened on first use, same as the composite service: a clone with no .env still boots. */
let projectStore: ProjectStore | undefined;
function getProjectStore(): ProjectStore {
  if (!projectStore) projectStore = createProjectStore(readProjectDbPath());
  return projectStore;
}

app.route("/api", createCompositeRoutes({ get: (request) => getService().get(request) }));
app.route("/api", createProjectRoutes(getProjectStore));

const port = Number(process.env.PORT ?? 8787);

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`bok-mapping-coast api listening on http://localhost:${info.port}`);
});

/**
 * Left alone, a taken port arrives as an unhandled 'error' event and a stack trace
 * through node:net that names neither the port nor the cause — which is, nearly
 * always, a second `pnpm dev` still running from another terminal or session.
 */
server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code !== "EADDRINUSE") throw error;
  console.error(
    `port ${port} is already in use — is another \`pnpm dev\` running?\n` +
      `Find it with:  lsof -nP -iTCP:${port} -sTCP:LISTEN\n` +
      `Or set PORT to start this API somewhere else.`,
  );
  process.exit(1);
});
