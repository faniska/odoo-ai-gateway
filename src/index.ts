/**
 * Node entrypoint: `node dist/index.js` (or `npm run dev`).
 * Config path: $ODOO_AI_GATEWAY_CONFIG, else ./gateway.config.yaml / .yml / .json, else the
 * GATEWAY_* environment variables (see gateway.env.example).
 */
import { existsSync } from "node:fs";

import { serve } from "@hono/node-server";

import { createApp, VERSION } from "./app.js";
import { configSource, loadConfigFromEnv } from "./config/env.js";
import { loadConfigFile } from "./config/load.js";
import { createHttpClient } from "./core/http-client.js";
import { createJsonLogger, type LogLevel } from "./core/logger.js";
import { createAdapters } from "./providers/index.js";

const logger = createJsonLogger((process.env.LOG_LEVEL as LogLevel | undefined) ?? "info");
const source = configSource(process.env, existsSync);
const config = "path" in source ? loadConfigFile(source.path) : loadConfigFromEnv();
if ("path" in source && process.env.GATEWAY_ROUTE_DEFAULT?.trim()) {
  logger.warn("a config file is in use: the GATEWAY_* configuration variables are ignored", { config: source.path });
}

const http = createHttpClient(
  Math.max(config.server.completionTimeoutSeconds, config.server.requestTimeoutSeconds, config.webhook.timeoutSeconds),
);
const { app, tasks } = createApp({ config, adapters: createAdapters(config, http.fetch), fetch: http.fetch, logger });

const server = serve({ fetch: app.fetch, hostname: config.server.host, port: config.server.port }, (info) => {
  logger.info("odoo-ai-gateway listening", {
    version: VERSION,
    address: info.address,
    port: info.port,
    config: "path" in source ? source.path : "env",
    providers: Object.keys(config.providers),
  });
  if (config.auth.allowAnyAccountToken) logger.warn("auth.allowAnyAccountToken is enabled: any caller can use your provider keys");
});

let stopping = false;
/**
 * Stop accepting connections, then wait for in-flight HTTP requests (sync completions,
 * embeddings, transcriptions) AND background async completions with their webhook deliveries,
 * under one deadline. Give the container at least this long to stop (docker --stop-timeout,
 * Kubernetes terminationGracePeriodSeconds).
 */
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  const budgetSeconds = config.server.completionTimeoutSeconds + config.webhook.timeoutSeconds * config.webhook.maxAttempts;
  logger.info("shutting down, draining requests and pending completions", { signal, pending: tasks.size, budget_seconds: budgetSeconds });
  const httpClosed = new Promise<void>((resolve) => server.close(() => resolve()));
  (server as { closeIdleConnections?: () => void }).closeIdleConnections?.();
  const deadline = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), budgetSeconds * 1000).unref());
  const outcome = await Promise.race([Promise.all([httpClosed, tasks.idle()]).then(() => "drained" as const), deadline]);
  if (outcome === "timeout") logger.warn("shutdown deadline reached, aborting in-flight requests", { pending: tasks.size });
  await http.close(outcome === "timeout");
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
