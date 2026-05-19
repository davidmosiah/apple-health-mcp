import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
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
import {
  buildProfileSummary,
  getOnboardingFlow,
  getProfile,
  getProfilePath,
  missingCriticalFields,
  updateProfile,
  type WellnessProfileDocument
} from "../services/profile-store.js";
import { buildDailySummary, buildWeeklySummary, formatSummaryMarkdown } from "../services/summary.js";
import { buildWellnessContext, formatWellnessContextMarkdown } from "../services/context.js";
import { buildDataInventory, formatInventoryMarkdown } from "../services/inventory.js";
import { buildExportFreshness, formatExportFreshnessMarkdown } from "../services/freshness.js";
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

  server.registerTool(
    "apple_health_quickstart",
    {
      title: "Apple Health Quickstart",
      description:
        "Personalized 3-step setup walkthrough for the human user. Adapts to current state (is APPLE_HEALTH_EXPORT_PATH set? does the export file exist and parse?). Call this first when the user asks 'how do I connect Apple Health?'. This connector is local-first and never touches Apple servers or cloud APIs.",
      inputSchema: ResponseOnlyInputSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ response_format }) => {
      const status = await buildConnectionStatus();
      const exportConfigured = Boolean(status.config.export_path);
      const exportReady = status.export.exists && status.ready_for_apple_health_export;
      const steps = [
        {
          step: 1,
          title: "Export All Health Data from your iPhone",
          action:
            "On iPhone: open the Health app -> tap your profile picture (top right) -> scroll to bottom -> Export All Health Data. The phone produces an `export.zip` (can take a few minutes for years of data).",
          done: false,
        },
        {
          step: 2,
          title: exportConfigured
            ? "(done) APPLE_HEALTH_EXPORT_PATH is configured"
            : "Transfer export.zip and point the connector at it",
          action: exportConfigured
            ? `Configured path: \`${status.config.export_path}\` (kind: ${status.export.kind}).`
            : "AirDrop or copy `export.zip` to this machine, then either set `APPLE_HEALTH_EXPORT_PATH=/path/to/export.zip` or run `apple-health-mcp-unofficial setup --export-path /path/to/export.zip`. The connector also accepts an unzipped Apple Health export directory or `export.xml` directly.",
          done: exportConfigured,
        },
        {
          step: 3,
          title: exportReady
            ? "(done) Export file is parseable — ready to read Apple Health data"
            : "Verify the export and run a first summary",
          action: exportReady
            ? "Call apple_health_data_inventory to discover date ranges, then apple_health_daily_summary, apple_health_weekly_summary or apple_health_wellness_context. Pair with wellness-nourish for recovery-aware meal coaching, wellness-cycle-coach for cycle-aware load adjustments, and wellness-cgm-mcp for metabolic-stress signals."
            : status.export.note
              ? `The configured export path is not parseable yet: ${status.export.note}`
              : "Once the export path is set, call apple_health_connection_status again; the connector reads `apple_health_export/export.xml` inside zips automatically.",
          example: exportReady
            ? "apple_health_wellness_context({ date: 'today' }) -> normalized recovery/training-load context for nourish/cycle-coach."
            : "Until the export is configured, the data tools surface a clear 'export not found' message.",
          done: exportReady,
        },
      ];
      const payload = {
        ok: true,
        ready: exportConfigured && exportReady,
        local_first: true,
        cloud_apis_used: "none",
        steps,
        next: steps.find((s) => !s.done) ?? steps[steps.length - 1],
        cross_connector_hints: [
          "Pair Apple Health activity + sleep with wellness-nourish for recovery-aware meal coaching.",
          "Pair Apple Health HRV / cycle data with wellness-cycle-coach for late-luteal load adjustments.",
          "Pair Apple Health activity + sleep with wellness-cgm-mcp glucose for metabolic-stress signals.",
        ],
        privacy: [
          "100% local: this MCP never calls Apple, iCloud, or any cloud API.",
          "The export.xml stays on disk; raw bytes are never uploaded.",
          "Default privacy_mode is `summary`; use `raw` only when the user explicitly asks for raw export attributes.",
        ],
      };
      const markdown = bulletList("Apple Health Quickstart", {
        ready: payload.ready,
        next: payload.next.title,
        local_first: true,
      });
      return makeResponse(payload, response_format, markdown);
    }
  );

  server.registerTool(
    "apple_health_demo",
    {
      title: "Apple Health Demo",
      description:
        "Returns realistic example payloads of apple_health_daily_summary, apple_health_weekly_summary, and apple_health_wellness_context with Apple-Watch-style values, so agents see the contract before parsing a real export.",
      inputSchema: ResponseOnlyInputSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ response_format }) => {
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
      const payload = {
        ok: true,
        is_demo: true,
        source: "apple_health_export",
        sample: {
          apple_health_daily_summary: {
            kind: "daily_summary",
            source: "apple_health",
            date: today,
            timezone: "America/Fortaleza",
            activity: { steps: 9341, distance_km: 7.12, active_energy_kcal: 612, exercise_minutes: 38 },
            heart: { resting_hr_bpm: 58, average_hr_bpm: 72, max_hr_bpm: 158, hrv_sdnn_ms: 45 },
            sleep: { duration_min: 432, in_bed_min: 462, asleep_min: 432, rem_min: 88, deep_min: 74, awakenings: 3 },
            respiratory: { respiratory_rate_brpm: 14, spo2_pct: 97 },
            ecg: { latest: { classification: "Sinus Rhythm", average_hr_bpm: 64, timestamp: `${yesterday}T22:14:00Z` } },
            workouts: 1,
          },
          apple_health_weekly_summary: {
            kind: "weekly_summary",
            source: "apple_health",
            end_date: today,
            days: 7,
            window: { start: sevenDaysAgo, end: today },
            activity: { avg_steps: 8472, total_distance_km: 51.6, avg_active_energy_kcal: 548, exercise_minutes_total: 247 },
            heart: { avg_resting_hr_bpm: 57, avg_hrv_sdnn_ms: 47 },
            sleep: { avg_duration_min: 423, avg_efficiency_pct: 92, nights_under_7h: 2 },
            workouts: { count: 4, types: { run: 2, strength_training: 1, yoga: 1 } },
            trend: "stable",
          },
          apple_health_wellness_context: {
            kind: "wellness_context",
            source: "apple_health",
            window: "last_24h",
            date: today,
            resting_hr_bpm: 58,
            hrv_sdnn_ms: 45,
            sleep_duration_min: 432,
            sleep_quality_band: "good",
            recent_training_load: "normal",
            soreness: [],
            injury_flags: [],
            recommendation: "Resting HR + HRV within personal baseline, sleep duration adequate. Green light for moderate-intensity training. Consider a magnesium-rich evening meal to keep HRV trending up.",
          },
        },
        notes: [
          "All sample data is synthetic; tagged with is_demo=true.",
          "Real calls parse the local Apple Health export.xml (or zip) — no cloud APIs, no Apple servers.",
          "Pair with wellness-nourish for recovery-aware meal coaching and wellness-cycle-coach for cycle-aware load adjustments.",
        ],
      };
      const markdown = bulletList("Apple Health Demo", {
        is_demo: true,
        steps: 9341,
        avg_hr_bpm: 72,
        hrv_sdnn_ms: 45,
        sleep_duration_min: 432,
        ecg_classification: "Sinus Rhythm",
        recommendation: payload.sample.apple_health_wellness_context.recommendation,
      });
      return makeResponse(payload, response_format, markdown);
    }
  );

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

  server.registerTool("apple_health_export_freshness", {
    title: "Apple Health Export Freshness",
    description:
      "Check how recently the local Apple Health export file/directory was written. Returns mtime, days_since_export, an is_stale flag, and a recommendation. Considered stale if the export is older than 30 days, or older than 7 days with no recent records (the inventory's latest-record date is also older than 7 days). Use before relying on apple_health_daily_summary or apple_health_wellness_context to confirm the export is fresh.",
    inputSchema: ResponseOnlyInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async ({ response_format }) => {
    try {
      const config = getConfig();
      // Lightweight: try to enrich with the inventory's latest-record age if the export is parseable.
      let daysSinceLatestRecord: number | undefined;
      try {
        const inventory = await buildDataInventory(config.exportPath, { timezone: config.timezone, privacyMode: "summary" });
        daysSinceLatestRecord = inventory.freshness.days_since_latest_data;
      } catch {
        // If inventory build fails (no export, parse error), fall back to mtime-only check.
      }
      const freshness = await buildExportFreshness(config.exportPath, { daysSinceLatestRecord });
      return makeResponse(freshness, response_format, formatExportFreshnessMarkdown(freshness));
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

  server.registerTool(
    "apple_health_profile_get",
    {
      title: "Get Delx Wellness Profile",
      description:
        "Read the shared Delx Wellness profile from ~/.delx-wellness/profile.json. Returns preferred name, goals, devices, training/nutrition/exercise/agent preferences and safety flags. NEVER contains OAuth tokens or API secrets — this connector is local-export and has no cloud auth, but the profile contract is the same across every Delx Wellness MCP. Read-only.",
      inputSchema: ResponseOnlyInputSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ response_format }) => {
      try {
        const profile = await getProfile();
        const payload = {
          ok: true,
          profile,
          summary: buildProfileSummary(profile),
          missing_critical: missingCriticalFields(profile),
          storage_path: getProfilePath()
        };
        return makeResponse(payload, response_format, bulletList("Delx Wellness Profile", {
          summary: payload.summary,
          missing_critical: payload.missing_critical,
          storage_path: payload.storage_path
        }));
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );

  server.registerTool(
    "apple_health_profile_update",
    {
      title: "Update Delx Wellness Profile",
      description:
        "Persist a partial patch to ~/.delx-wellness/profile.json. Requires explicit_user_intent=true (otherwise returns USER_ACTION_REQUIRED). Rejects secret-like fields (oauth, token, secret, password, cookie, refresh, api_key, session) at write time. Use to record preferred name, goals, devices, training context, nutrition context, exercise preferences, agent preferences, and safety flags.",
      inputSchema: {
        patch: z.record(z.string(), z.unknown()).describe("Partial WellnessProfileDocument patch. Top-level keys: profile, goals, devices, training, nutrition, preferences, safety, notes."),
        explicit_user_intent: z.boolean().optional().describe("Must be true to persist. Prevents accidental writes from agent inference."),
        response_format: z.enum(["markdown", "json"]).default("markdown")
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ patch, explicit_user_intent, response_format }) => {
      try {
        if (explicit_user_intent !== true) {
          return makeResponse(
            {
              ok: false,
              error: "USER_ACTION_REQUIRED",
              message: "Profile update requires explicit_user_intent=true. Confirm with the user before persisting."
            },
            response_format,
            bulletList("Delx Wellness Profile Update", {
              ok: false,
              error: "USER_ACTION_REQUIRED",
              hint: "Set explicit_user_intent=true once the user has confirmed."
            })
          );
        }
        const updated = await updateProfile(patch as Partial<WellnessProfileDocument>);
        const payload = {
          ok: true,
          profile: updated,
          summary: buildProfileSummary(updated),
          missing_critical: missingCriticalFields(updated),
          storage_path: getProfilePath()
        };
        return makeResponse(payload, response_format, bulletList("Delx Wellness Profile Updated", {
          summary: payload.summary,
          missing_critical: payload.missing_critical,
          storage_path: payload.storage_path
        }));
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );

  server.registerTool(
    "apple_health_onboarding",
    {
      title: "Delx Wellness Onboarding Flow",
      description:
        "Return the 11-question onboarding flow plus the current profile state and missing fields. Read-only — does NOT persist anything. Pair with apple_health_profile_update once the user answers. Cross-connector: the same profile is shared by every Delx Wellness MCP (whoop, garmin, oura, fitbit, strava, polar, withings, apple-health, samsung-health, google-health, nourish, cycle-coach, cgm, air).",
      inputSchema: {
        locale: z.enum(["en", "pt-BR"]).optional().describe("Onboarding locale. Defaults to en."),
        response_format: z.enum(["markdown", "json"]).default("markdown")
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ locale, response_format }) => {
      try {
        const flow = getOnboardingFlow(locale ?? "en");
        const profile = await getProfile();
        const payload = {
          ok: true,
          flow,
          current_profile: profile,
          missing_critical: missingCriticalFields(profile),
          cross_connector_hint:
            "This profile is shared across all Delx Wellness connectors. Answering once populates context for whoop, garmin, oura, fitbit, strava, polar, withings, apple-health, samsung-health, google-health, nourish, cycle-coach, cgm, and air."
        };
        return makeResponse(payload, response_format, bulletList("Delx Wellness Onboarding", {
          locale: flow.locale,
          questions: `${flow.questions.length} questions`,
          storage_path: flow.storage_path,
          missing_critical: payload.missing_critical,
          privacy_note: flow.privacy_note
        }));
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );
}
