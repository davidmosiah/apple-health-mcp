#!/usr/bin/env node
import cors from "cors";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { watch as watchFs } from "node:fs";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { runCliCommand } from "./cli/commands.js";
import { registerAppleHealthPrompts } from "./prompts/apple-health-prompts.js";
import { registerAppleHealthResources } from "./resources/apple-health-resources.js";
import { registerAppleHealthTools } from "./tools/apple-health-tools.js";
import { reconcileWatchFolder, resolveWatchPath } from "./services/watch.js";

/**
 * Promote a newer export from the watch folder (if any) at startup. Best-effort:
 * a missing/empty watch folder is a no-op and never blocks server boot.
 */
async function reconcileWatchOnStart(): Promise<void> {
  try {
    const result = await reconcileWatchFolder();
    if (result.changed) console.error(`[apple-health-mcp] ${result.message}`);
  } catch (error) {
    console.error(`[apple-health-mcp] Watch-folder reconcile failed: ${(error as Error).message}`);
  }
}

/**
 * For long-running transports, watch the folder for filesystem changes and
 * reconcile (debounced) so a freshly dropped export is picked up without a
 * manual `apple_health_reimport` call. No-op when no watch folder is configured.
 */
function startWatchFolderWatcher(): void {
  const watchPath = resolveWatchPath();
  if (!watchPath) return;
  let timer: NodeJS.Timeout | undefined;
  try {
    const watcher = watchFs(watchPath, { recursive: true }, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void reconcileWatchOnStart();
      }, 1500);
    });
    watcher.on("error", (error) => {
      console.error(`[apple-health-mcp] Watch-folder watcher error: ${error.message}`);
    });
    console.error(`[apple-health-mcp] Watching ${watchPath} for new Apple Health exports.`);
  } catch (error) {
    // `recursive` is unsupported on some platforms; degrade to startup + tool-driven reconcile.
    console.error(`[apple-health-mcp] Live watch unavailable (${(error as Error).message}); using on-demand reimport.`);
  }
}

function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION
  });
  registerAppleHealthTools(server);
  registerAppleHealthResources(server);
  registerAppleHealthPrompts(server);
  return server;
}

async function runStdio(): Promise<void> {
  await reconcileWatchOnStart();
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function runHttp(): Promise<void> {
  const app = express();
  const host = process.env.APPLE_HEALTH_MCP_HOST ?? "127.0.0.1";
  const port = Number(process.env.APPLE_HEALTH_MCP_PORT ?? 3000);
  const allowedOrigin = process.env.APPLE_HEALTH_MCP_ALLOWED_ORIGIN ?? `http://${host}:${port}`;

  app.use(express.json({ limit: "1mb" }));
  app.use(cors({ origin: allowedOrigin }));
  app.get("/health", (_req, res) => {
    res.json({ ok: true, name: SERVER_NAME, version: SERVER_VERSION });
  });
  app.post("/mcp", async (req, res) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });
    res.on("close", () => {
      transport.close().catch(() => undefined);
      server.close().catch(() => undefined);
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP HTTP request failed:", error);
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  });
  await reconcileWatchOnStart();
  startWatchFolderWatcher();
  app.listen(port, host, () => {
    console.error(`${SERVER_NAME} HTTP transport listening on http://${host}:${port}/mcp`);
  });
}

const args = new Set(process.argv.slice(2));
let cliResult: number | undefined;

try {
  cliResult = await runCliCommand(process.argv.slice(2));
} catch (error) {
  console.error(`Error: ${(error as Error).message}`);
  process.exitCode = 1;
}

if (cliResult !== undefined) {
  process.exitCode = cliResult;
} else if (process.exitCode === undefined) {
  const transport = process.env.APPLE_HEALTH_MCP_TRANSPORT ?? (args.has("--http") ? "http" : "stdio");
  if (transport === "http") await runHttp();
  else await runStdio();
}
