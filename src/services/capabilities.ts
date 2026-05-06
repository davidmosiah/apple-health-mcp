import { SUPPORTED_RECORD_TYPES } from "../constants.js";

export function buildCapabilities() {
  return {
    project: "apple-health-mcp-unofficial",
    mcp_name: "io.github.davidmosiah/apple-health-mcp",
    creator: {
      name: "David Mosiah",
      github: "https://github.com/davidmosiah"
    },
    unofficial: true,
    api_boundary: {
      source: "Apple Health export.xml",
      raw_definition: "Raw means records from a user-provided Apple Health export file.",
      healthkit_live_access: false,
      does_not_include: [
        "live HealthKit reads",
        "iCloud Health data access",
        "Apple account login",
        "device sensor streaming",
        "medical diagnosis"
      ]
    },
    supported_data: [
      { name: "Activity", examples: ["steps", "distance", "active energy"], tools: ["apple_health_list_records", "apple_health_daily_summary"] },
      { name: "Heart", examples: ["heart rate", "resting heart rate", "HRV SDNN"], tools: ["apple_health_list_records", "apple_health_daily_summary"] },
      { name: "Sleep", examples: ["sleep analysis categories and durations"], tools: ["apple_health_list_records", "apple_health_daily_summary", "apple_health_wellness_context"] },
      { name: "Workouts", examples: ["activity type", "duration", "distance", "energy"], tools: ["apple_health_list_workouts", "apple_health_weekly_summary"] },
      { name: "Inventory", examples: ["available date range", "record types", "export freshness"], tools: ["apple_health_data_inventory"] }
    ],
    supported_record_types: SUPPORTED_RECORD_TYPES,
    recommended_agent_flow: [
      "Call apple_health_agent_manifest when installing or operating inside an agent runtime.",
      "Call apple_health_connection_status before reading export data.",
      "Call apple_health_data_inventory to discover available data, stale exports and safe next calls.",
      "Use apple_health_daily_summary or apple_health_weekly_summary before low-level record calls.",
      "Use apple_health_wellness_context when handing export-derived sleep/activity context to Exercise Catalog.",
      "Do not ask users to paste raw export.xml content into chat.",
      "Do not claim live HealthKit access; this connector reads local Apple Health exports."
    ],
    privacy_modes: [
      { mode: "summary", use_when: "The agent only needs daily or weekly aggregates." },
      { mode: "structured", use_when: "The user wants bounded records without source names, creation dates or raw metadata." },
      { mode: "raw", use_when: "The user explicitly asks for raw export record attributes." }
    ],
    links: {
      github: "https://github.com/davidmosiah/apple-health-mcp",
      apple_healthkit_docs: "https://developer.apple.com/documentation/healthkit/about-the-healthkit-framework",
      delx_wellness: "https://github.com/davidmosiah/delx-wellness"
    }
  };
}
