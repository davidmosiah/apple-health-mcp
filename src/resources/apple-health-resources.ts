import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildAgentManifest, formatAgentManifestMarkdown } from "../services/agent-manifest.js";
import { buildCapabilities } from "../services/capabilities.js";
import { getConfig } from "../services/config.js";
import { buildDataInventory } from "../services/inventory.js";
import { buildDailySummary, buildWeeklySummary } from "../services/summary.js";

function jsonResource(uri: URL, data: unknown) {
  return {
    contents: [{ uri: uri.toString(), mimeType: "application/json", text: JSON.stringify(data, null, 2) }]
  };
}

function textResource(uri: URL, text: string) {
  return {
    contents: [{ uri: uri.toString(), mimeType: "text/markdown", text }]
  };
}

export function registerAppleHealthResources(server: McpServer): void {
  server.registerResource("apple_health_agent_manifest", "apple-health://agent-manifest", {
    title: "Apple Health Agent Manifest",
    description: "Machine-readable install and operating instructions for AI agents.",
    mimeType: "text/markdown"
  }, async (uri) => textResource(uri, formatAgentManifestMarkdown(buildAgentManifest("generic"))));

  server.registerResource("apple_health_capabilities", "apple-health://capabilities", {
    title: "Apple Health MCP Capabilities",
    description: "Static capabilities, data boundary, privacy modes and recommended agent workflow.",
    mimeType: "application/json"
  }, async (uri) => jsonResource(uri, buildCapabilities()));

  server.registerResource("apple_health_data_inventory_resource", "apple-health://inventory", {
    title: "Apple Health Data Inventory",
    description: "Available record types, workouts, date coverage and data freshness for the configured export.",
    mimeType: "application/json"
  }, async (uri) => {
    const config = getConfig();
    return jsonResource(uri, await buildDataInventory(config.exportPath, { timezone: config.timezone, privacyMode: config.privacyMode }));
  });

  server.registerResource("apple_health_daily_summary_resource", "apple-health://summary/daily", {
    title: "Apple Health Daily Summary",
    description: "Daily Apple Health export summary for the current UTC day.",
    mimeType: "application/json"
  }, async (uri) => {
    const config = getConfig();
    return jsonResource(uri, await buildDailySummary(config.exportPath, undefined, { timezone: config.timezone }));
  });

  server.registerResource("apple_health_weekly_summary_resource", "apple-health://summary/weekly", {
    title: "Apple Health Weekly Summary",
    description: "Weekly Apple Health export summary for the current UTC week window.",
    mimeType: "application/json"
  }, async (uri) => {
    const config = getConfig();
    return jsonResource(uri, await buildWeeklySummary(config.exportPath, undefined, undefined, { timezone: config.timezone }));
  });
}
