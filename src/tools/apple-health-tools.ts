import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  AgentManifestInputSchema,
  ConnectionStatusInputSchema,
  DailySummaryInputSchema,
  InventoryInputSchema,
  RecordListInputSchema,
  ResponseOnlyInputSchema,
  WellnessContextInputSchema,
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
import { buildWellnessContext, formatWellnessContextMarkdown } from "../services/context.js";
import { buildDataInventory, formatInventoryMarkdown } from "../services/inventory.js";
import { recordPrivacyView, workoutPrivacyView } from "../services/privacy.js";

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
        recommended_first_tools: "apple_health_connection_status, apple_health_data_inventory, apple_health_daily_summary, apple_health_weekly_summary"
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
      const privacyMode = params.privacy_mode ?? config.privacyMode;
      const output = {
        source: "apple_health_export",
        type: params.type,
        privacy_mode: privacyMode,
        count: records.length,
        ...recordPrivacyView(records, privacyMode, config.timezone)
      };
      return makeResponse(output, params.response_format, bulletList("Apple Health Records", {
        type: params.type ?? "any",
        count: records.length,
        source: "apple_health_export",
        privacy_mode: privacyMode
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
      const privacyMode = params.privacy_mode ?? config.privacyMode;
      const output = {
        source: "apple_health_export",
        privacy_mode: privacyMode,
        count: workouts.length,
        ...workoutPrivacyView(workouts, privacyMode, config.timezone)
      };
      return makeResponse(output, params.response_format, bulletList("Apple Health Workouts", {
        count: workouts.length,
        source: "apple_health_export",
        privacy_mode: privacyMode
      }));
    } catch (error) {
      return makeError((error as Error).message);
    }
  });

  server.registerTool("apple_health_data_inventory", {
    title: "Apple Health Data Inventory",
    description: "Scan the local Apple Health export once and report available record types, workouts, date coverage, freshness and safe next calls.",
    inputSchema: InventoryInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async ({ start, end, timezone, privacy_mode, response_format }) => {
    try {
      const config = getConfig();
      const inventory = await buildDataInventory(config.exportPath, {
        start,
        end,
        timezone: timezone ?? config.timezone,
        privacyMode: privacy_mode ?? config.privacyMode
      });
      return makeResponse(inventory, response_format, formatInventoryMarkdown(inventory));
    } catch (error) {
      return makeError((error as Error).message);
    }
  });

  server.registerTool("apple_health_daily_summary", {
    title: "Apple Health Daily Summary",
    description: "Build a daily wellness summary from local Apple Health export data. It is not live HealthKit and not medical advice.",
    inputSchema: DailySummaryInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async ({ date, timezone, response_format }) => {
    try {
      const config = getConfig();
      const summary = await buildDailySummary(config.exportPath, date, { timezone: timezone ?? config.timezone });
      return makeResponse(summary, response_format, formatSummaryMarkdown(summary));
    } catch (error) {
      return makeError((error as Error).message);
    }
  });

  server.registerTool("apple_health_wellness_context", {
    title: "Apple Health Wellness Context",
    description: "Normalize local Apple Health export sleep, workout and activity data into the shared wellness_context shape for recommendation engines.",
    inputSchema: WellnessContextInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async ({ date, timezone, soreness, injury_flags, notes, response_format }) => {
    try {
      const config = getConfig();
      const context = await buildWellnessContext(config.exportPath, { date, timezone: timezone ?? config.timezone, soreness, injury_flags, notes });
      return makeResponse(context, response_format, formatWellnessContextMarkdown(context));
    } catch (error) {
      return makeError((error as Error).message);
    }
  });

  server.registerTool("apple_health_weekly_summary", {
    title: "Apple Health Weekly Summary",
    description: "Build a weekly wellness summary from local Apple Health export data. It is not live HealthKit and not medical advice.",
    inputSchema: WeeklySummaryInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async ({ end_date, days, timezone, response_format }) => {
    try {
      const config = getConfig();
      const summary = await buildWeeklySummary(config.exportPath, end_date, days, { timezone: timezone ?? config.timezone });
      return makeResponse(summary, response_format, formatSummaryMarkdown(summary));
    } catch (error) {
      return makeError((error as Error).message);
    }
  });
}
