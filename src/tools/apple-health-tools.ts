import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  AgentManifestInputSchema,
  ConnectionStatusInputSchema,
  DailySummaryInputSchema,
  RecordListInputSchema,
  ResponseOnlyInputSchema,
  WeeklySummaryInputSchema,
  WorkoutListInputSchema
} from "../schemas/common.js";
import { buildAgentManifest, formatAgentManifestMarkdown } from "../services/agent-manifest.js";
import { buildPrivacyAudit } from "../services/audit.js";
import { buildCapabilities } from "../services/capabilities.js";
import { getConfig } from "../services/config.js";
import { buildConnectionStatus } from "../services/connection-status.js";
import { listRecords, listWorkouts } from "../services/apple-health-export.js";
import { bulletList, makeError, makeResponse } from "../services/format.js";
import { buildDailySummary, buildWeeklySummary, formatSummaryMarkdown } from "../services/summary.js";

export function registerAppleHealthTools(server: McpServer): void {
  server.registerTool("apple_health_agent_manifest", {
    title: "Apple Health Agent Manifest",
    description: "Machine-readable install, runtime and privacy guidance for AI agents operating Apple Health export data.",
    inputSchema: AgentManifestInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ client, response_format }) => {
    const manifest = buildAgentManifest(client);
    return makeResponse(manifest, response_format, formatAgentManifestMarkdown(manifest));
  });

  server.registerTool("apple_health_capabilities", {
    title: "Apple Health MCP Capabilities",
    description: "Explain supported Apple Health export data, unavailable live HealthKit access, privacy modes and recommended agent workflow.",
    inputSchema: ResponseOnlyInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ response_format }) => {
    const capabilities = buildCapabilities();
    return makeResponse(capabilities, response_format, bulletList("Apple Health MCP Capabilities", {
      project: capabilities.project,
      source: capabilities.api_boundary.source,
      live_healthkit_access: capabilities.api_boundary.healthkit_live_access,
      recommended_first_tools: "apple_health_connection_status, apple_health_daily_summary, apple_health_weekly_summary"
    }));
  });

  server.registerTool("apple_health_connection_status", {
    title: "Apple Health Connection Status",
    description: "Check local Apple Health export path, Node version, privacy mode and Hermes client posture without reading full export data.",
    inputSchema: ConnectionStatusInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ client, response_format }) => {
    const status = await buildConnectionStatus({ client });
    return makeResponse(status, response_format, bulletList("Apple Health Connection Status", {
      ok: status.ok,
      ready_for_apple_health_export: status.ready_for_apple_health_export,
      export_kind: status.export.kind,
      export_exists: status.export.exists,
      next_steps: status.next_steps.join(" | ")
    }));
  });

  server.registerTool("apple_health_privacy_audit", {
    title: "Apple Health Privacy Audit",
    description: "Return the local privacy and export-file posture without revealing health data.",
    inputSchema: ResponseOnlyInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ response_format }) => {
    const audit = buildPrivacyAudit();
    return makeResponse(audit, response_format, bulletList("Apple Health Privacy Audit", audit));
  });

  server.registerTool("apple_health_list_records", {
    title: "List Apple Health Records",
    description: "List bounded records from a local Apple Health export.xml. Use type/start/end filters to keep output small.",
    inputSchema: RecordListInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (params) => {
    try {
      const config = getConfig();
      const records = await listRecords({ exportPath: config.exportPath, type: params.type, start: params.start, end: params.end, limit: params.limit });
      const output = {
        source: "apple_health_export",
        type: params.type,
        privacy_mode: params.privacy_mode ?? config.privacyMode,
        count: records.length,
        records
      };
      return makeResponse(output, params.response_format, bulletList("Apple Health Records", {
        type: params.type ?? "any",
        count: records.length,
        source: "apple_health_export"
      }));
    } catch (error) {
      return makeError((error as Error).message);
    }
  });

  server.registerTool("apple_health_list_workouts", {
    title: "List Apple Health Workouts",
    description: "List bounded workout records from a local Apple Health export.xml.",
    inputSchema: WorkoutListInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (params) => {
    try {
      const config = getConfig();
      const workouts = await listWorkouts({ exportPath: config.exportPath, start: params.start, end: params.end, limit: params.limit });
      const output = {
        source: "apple_health_export",
        privacy_mode: params.privacy_mode ?? config.privacyMode,
        count: workouts.length,
        workouts
      };
      return makeResponse(output, params.response_format, bulletList("Apple Health Workouts", {
        count: workouts.length,
        source: "apple_health_export"
      }));
    } catch (error) {
      return makeError((error as Error).message);
    }
  });

  server.registerTool("apple_health_daily_summary", {
    title: "Apple Health Daily Summary",
    description: "Build a daily wellness summary from local Apple Health export data. It is not live HealthKit and not medical advice.",
    inputSchema: DailySummaryInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async ({ date, response_format }) => {
    try {
      const summary = await buildDailySummary(getConfig().exportPath, date);
      return makeResponse(summary, response_format, formatSummaryMarkdown(summary));
    } catch (error) {
      return makeError((error as Error).message);
    }
  });

  server.registerTool("apple_health_weekly_summary", {
    title: "Apple Health Weekly Summary",
    description: "Build a weekly wellness summary from local Apple Health export data. It is not live HealthKit and not medical advice.",
    inputSchema: WeeklySummaryInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async ({ end_date, days, response_format }) => {
    try {
      const summary = await buildWeeklySummary(getConfig().exportPath, end_date, days);
      return makeResponse(summary, response_format, formatSummaryMarkdown(summary));
    } catch (error) {
      return makeError((error as Error).message);
    }
  });
}
