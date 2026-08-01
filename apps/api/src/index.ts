import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createCompositeCache } from "./cache.js";
import { createProcessClient } from "./cdse/process.js";
import { createTokenSource } from "./cdse/token.js";
import { type CompositeService, createCompositeService } from "./composite.js";
import { readCacheDir, readCdseCredentials } from "./config.js";
import { createCompositeRoutes } from "./routes/composite.js";

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

app.route("/api", createCompositeRoutes({ get: (request) => getService().get(request) }));

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`bok-mapping-coast api listening on http://localhost:${info.port}`);
});
