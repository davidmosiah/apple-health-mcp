/**
 * Export freshness check for the local Apple Health export file/directory.
 *
 * Returns the export file mtime, days since export, an `is_stale` flag, and a
 * `recommendation` string. Stale when:
 *   - mtime is older than 30 days, OR
 *   - mtime is older than 7 days AND no recent records were found in the export.
 *
 * The result is intended to surface in both the dedicated
 * `apple_health_export_freshness` workflow tool and inside
 * `apple_health_connection_status` as a warning when the export is stale.
 */
import { inspectExportLocation, type ExportLocation } from "./apple-health-export.js";

const STALE_DAYS_HARD = 30;
const STALE_DAYS_SOFT = 7;
const MS_PER_DAY = 86_400_000;

export interface ExportFreshness {
  ok: boolean;
  ready_for_apple_health_export: boolean;
  export_path?: string;
  export_kind: ExportLocation["kind"];
  exists: boolean;
  modified_at?: string;
  mtime_ms?: number;
  days_since_export?: number;
  is_stale: boolean;
  stale_reason?: "no_export" | "older_than_30d" | "older_than_7d_and_no_recent_records" | null;
  recent_records_found?: boolean;
  days_since_latest_record?: number;
  recommendation: string;
  thresholds: {
    hard_days: number;
    soft_days: number;
  };
  [key: string]: unknown;
}

export interface FreshnessOptions {
  /** Override "now" for deterministic tests. */
  now?: () => number;
  /**
   * Provide a `days_since_latest_record` value computed elsewhere (e.g. from
   * inventory). Used by the connection-status warning and by tests so we don't
   * parse the whole export twice.
   */
  daysSinceLatestRecord?: number;
}

export async function buildExportFreshness(
  exportPath: string | undefined,
  options: FreshnessOptions = {}
): Promise<ExportFreshness> {
  const now = options.now?.() ?? Date.now();
  const location = await inspectExportLocation(exportPath);
  const ready = location.exists;

  if (!ready || location.mtime_ms === undefined) {
    return {
      ok: false,
      ready_for_apple_health_export: false,
      export_path: exportPath,
      export_kind: location.kind,
      exists: false,
      modified_at: location.modified_at,
      mtime_ms: location.mtime_ms,
      days_since_export: undefined,
      is_stale: true,
      stale_reason: "no_export",
      recommendation:
        location.note ??
        "No Apple Health export found. Run `apple-health-mcp-server setup --export-path /path/to/export.xml` or set APPLE_HEALTH_EXPORT_PATH.",
      thresholds: { hard_days: STALE_DAYS_HARD, soft_days: STALE_DAYS_SOFT }
    };
  }

  const days = (now - location.mtime_ms) / MS_PER_DAY;
  const daysSinceExport = Math.max(0, Math.floor(days));
  const recentRecordDays = options.daysSinceLatestRecord;
  const recentRecordsFound =
    typeof recentRecordDays === "number" ? recentRecordDays <= STALE_DAYS_SOFT : undefined;

  let staleReason: ExportFreshness["stale_reason"] = null;
  if (daysSinceExport > STALE_DAYS_HARD) {
    staleReason = "older_than_30d";
  } else if (daysSinceExport > STALE_DAYS_SOFT && recentRecordsFound === false) {
    staleReason = "older_than_7d_and_no_recent_records";
  }
  const isStale = staleReason !== null;

  let recommendation: string;
  if (staleReason === "older_than_30d") {
    recommendation = `Consider re-exporting (>${STALE_DAYS_HARD} days old). On iPhone: Health app → profile picture → Export All Health Data, then transfer the new export.zip.`;
  } else if (staleReason === "older_than_7d_and_no_recent_records") {
    recommendation = `Export is ${daysSinceExport} days old and the latest record in it is ${recentRecordDays} days old. Re-export from the Health app for fresh data.`;
  } else {
    recommendation = "Export is fresh";
  }

  return {
    ok: true,
    ready_for_apple_health_export: ready,
    export_path: exportPath,
    export_kind: location.kind,
    exists: true,
    modified_at: location.modified_at,
    mtime_ms: location.mtime_ms,
    days_since_export: daysSinceExport,
    is_stale: isStale,
    stale_reason: staleReason,
    recent_records_found: recentRecordsFound,
    days_since_latest_record: recentRecordDays,
    recommendation,
    thresholds: { hard_days: STALE_DAYS_HARD, soft_days: STALE_DAYS_SOFT }
  };
}

export function formatExportFreshnessMarkdown(freshness: ExportFreshness): string {
  return [
    "# Apple Health Export Freshness",
    "",
    `- **exists**: ${freshness.exists}`,
    `- **kind**: ${freshness.export_kind}`,
    `- **modified_at**: ${freshness.modified_at ?? "unknown"}`,
    `- **days_since_export**: ${freshness.days_since_export ?? "unknown"}`,
    `- **is_stale**: ${freshness.is_stale}`,
    freshness.stale_reason ? `- **stale_reason**: ${freshness.stale_reason}` : "",
    `- **recommendation**: ${freshness.recommendation}`
  ]
    .filter(Boolean)
    .join("\n");
}
