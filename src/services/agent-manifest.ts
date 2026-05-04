import { NPM_PACKAGE_NAME, PINNED_NPM_PACKAGE, SERVER_VERSION, SUPPORTED_RECORD_TYPES } from "../constants.js";

export const AGENT_CLIENTS = ["generic", "claude", "cursor", "windsurf", "hermes", "openclaw"] as const;
export type AgentClientName = typeof AGENT_CLIENTS[number];

export const HERMES_DIRECT_TOOLS = [
  "mcp_apple_health_apple_health_agent_manifest",
  "mcp_apple_health_apple_health_connection_status",
  "mcp_apple_health_apple_health_daily_summary",
  "mcp_apple_health_apple_health_weekly_summary",
  "mcp_apple_health_apple_health_wellness_context",
  "mcp_apple_health_apple_health_list_records",
  "mcp_apple_health_apple_health_list_workouts"
];

const STANDARD_TOOLS = [
  "apple_health_agent_manifest",
  "apple_health_capabilities",
  "apple_health_connection_status",
  "apple_health_list_records",
  "apple_health_list_workouts",
  "apple_health_daily_summary",
  "apple_health_weekly_summary",
  "apple_health_wellness_context",
  "apple_health_privacy_audit"
];

export function parseAgentClientName(value: string | undefined): AgentClientName {
  return AGENT_CLIENTS.includes(value as AgentClientName) ? value as AgentClientName : "generic";
}

export function buildAgentManifest(client: AgentClientName = "generic") {
  return {
    project: "apple-health-mcp-unofficial",
    mcp_name: "io.github.davidmosiah/apple-health-mcp",
    client,
    unofficial: true,
    healthkit_live_access: false,
    package: {
      name: NPM_PACKAGE_NAME,
      version: SERVER_VERSION,
      install_command: `npx -y ${NPM_PACKAGE_NAME}`,
      pinned_install_command: `npx -y ${PINNED_NPM_PACKAGE}`,
      binary: "apple-health-mcp-server"
    },
    data_model: {
      source: "Apple Health export.xml from the Health app export flow",
      live_healthkit_bridge: "planned native iOS bridge; not available in this Node MCP server",
      export_path_env: "APPLE_HEALTH_EXPORT_PATH",
      local_config: "~/.apple-health-mcp/config.json",
      supported_record_types: SUPPORTED_RECORD_TYPES
    },
    recommended_first_calls: ["apple_health_connection_status", "apple_health_wellness_context", "apple_health_daily_summary", "apple_health_weekly_summary"],
    standard_tools: STANDARD_TOOLS,
    resources: ["apple-health://agent-manifest", "apple-health://capabilities", "apple-health://summary/daily", "apple-health://summary/weekly"],
    hermes: {
      config_path: "~/.hermes/config.yaml",
      skill_path: "~/.hermes/skills/apple-health-mcp/SKILL.md",
      tool_name_prefix: "mcp_apple_health_",
      common_tool_names: HERMES_DIRECT_TOOLS,
      recommended_config: hermesConfigSnippet(),
      use_direct_tools: true,
      avoid_terminal_workarounds: true,
      no_gateway_restart_for_data_access: true,
      reload_after_config_change: "/reload-mcp or hermes mcp test apple_health",
      doctor_command: "npx -y apple-health-mcp-unofficial doctor --client hermes --json"
    },
    agent_rules: [
      "Start with apple_health_connection_status and do not assume an export exists.",
      "Ask the user for a local Apple Health export path, not raw health data pasted into chat.",
      "Treat export.xml as sensitive health data and never print full raw exports.",
      "Do not claim live HealthKit access from Node. This connector reads Apple Health exports; native live bridge is a separate future component.",
      "For Hermes, do not restart the gateway for normal Apple Health data access; reload MCP instead.",
      "Do not provide medical diagnosis or treatment instructions. Frame outputs as wellness, activity and recovery context."
    ],
    troubleshooting: [
      { symptom: "missing APPLE_HEALTH_EXPORT_PATH", action: "Run `apple-health-mcp-server setup --export-path /path/to/export.xml` or set APPLE_HEALTH_EXPORT_PATH." },
      { symptom: "export path points to a directory", action: "Use the Apple export directory or apple_health_export/export.xml; both are supported." },
      { symptom: "export path points to export.zip", action: "The connector reads apple_health_export/export.xml inside the zip without extracting it." },
      { symptom: "agent asks for live HealthKit data", action: "Explain that HealthKit live access requires a native iOS bridge, not this Node-only MCP." }
    ],
    links: {
      github: "https://github.com/davidmosiah/apple-health-mcp",
      apple_healthkit_docs: "https://developer.apple.com/documentation/healthkit/about-the-healthkit-framework",
      delx_wellness: "https://github.com/davidmosiah/delx-wellness"
    }
  };
}

export function formatAgentManifestMarkdown(manifest: ReturnType<typeof buildAgentManifest>): string {
  return `# Apple Health MCP Agent Manifest

Unofficial: ${manifest.unofficial}
Package: \`${manifest.package.name}\` v${manifest.package.version}
Install: \`${manifest.package.install_command}\`
Pinned install: \`${manifest.package.pinned_install_command}\`

## Data Boundary
Source: ${manifest.data_model.source}
Live HealthKit: ${manifest.healthkit_live_access ? "available" : "not available in this Node connector"}
Export env: \`${manifest.data_model.export_path_env}\`

## First Calls
${manifest.recommended_first_calls.map((tool) => `- \`${tool}\``).join("\n")}

## Hermes
Config: \`${manifest.hermes.config_path}\`
Skill: \`${manifest.hermes.skill_path}\`
Reload: \`${manifest.hermes.reload_after_config_change}\`
Direct tools:
${manifest.hermes.common_tool_names.map((tool) => `- \`${tool}\``).join("\n")}

## Agent Rules
${manifest.agent_rules.map((rule) => `- ${rule}`).join("\n")}
`;
}

export function hermesConfigSnippet(): string {
  return `mcp_servers:\n  apple_health:\n    command: npx\n    args:\n      - -y\n      - ${PINNED_NPM_PACKAGE}\n    timeout: 120\n    connect_timeout: 60\n    sampling:\n      enabled: false`;
}

export function hermesSkillMarkdown(): string {
  return `# Apple Health MCP Skill

Use this skill whenever a user asks Hermes to inspect Apple Health export data, Apple Watch activity, sleep, heart-rate, HRV, workouts, daily summaries or weekly summaries through the Apple Health MCP.

## Rules
- Start with \`mcp_apple_health_apple_health_connection_status\`.
- Prefer \`mcp_apple_health_apple_health_daily_summary\` and \`mcp_apple_health_apple_health_weekly_summary\` before low-level record calls.
- Treat Apple Health exports as sensitive. Do not request raw export text in chat.
- This connector reads Apple Health export files. Do not claim live HealthKit access from Node.
- Do not diagnose or treat medical conditions.
- Reload MCP with \`/reload-mcp\` or \`hermes mcp test apple_health\`; do not restart the gateway for normal data access.
`;
}
