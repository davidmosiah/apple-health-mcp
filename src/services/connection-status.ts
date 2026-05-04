import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PINNED_NPM_PACKAGE } from "../constants.js";
import type { AppleHealthConfig } from "../types.js";
import { HERMES_DIRECT_TOOLS, type AgentClientName } from "./agent-manifest.js";
import { getConfig } from "./config.js";
import { inspectExportLocation } from "./apple-health-export.js";
import { localConfigPath } from "./local-config.js";

export async function buildConnectionStatus(options: { client?: AgentClientName; env?: NodeJS.ProcessEnv; homeDir?: string } = {}) {
  const homeDir = options.homeDir ?? homedir();
  const config: AppleHealthConfig = getConfig(options.env ?? process.env, homeDir);
  const location = await inspectExportLocation(config.exportPath);
  const nodeSupported = Number(process.versions.node.split(".")[0] ?? 0) >= 20;
  const clientChecks = options.client === "hermes" ? { hermes: await inspectHermesClient(homeDir) } : undefined;
  const ok = nodeSupported && location.exists;
  return {
    ok,
    ready_for_apple_health_export: location.exists,
    client: options.client,
    node: {
      version: process.versions.node,
      supported: nodeSupported
    },
    config: {
      path: localConfigPath(homeDir),
      export_path: config.exportPath,
      privacy_mode: config.privacyMode
    },
    export: location,
    client_checks: clientChecks,
    next_steps: buildNextSteps({ nodeSupported, location })
  };
}

async function inspectHermesClient(homeDir: string) {
  const configPath = join(homeDir, ".hermes", "config.yaml");
  const skillPath = join(homeDir, ".hermes", "skills", "apple-health-mcp", "SKILL.md");
  const [config, skillExists] = await Promise.all([readOptionalText(configPath), existsFile(skillPath)]);
  const text = config.text ?? "";
  const check = {
    config_path: configPath,
    config_exists: config.exists,
    apple_health_server_configured: /apple-health-mcp-unofficial|apple-health-mcp-server|apple-health-mcp/.test(text) && /^\s*apple_health\s*:/m.test(text),
    package_pinned: /apple-health-mcp-unofficial@\d+\.\d+\.\d+/.test(text),
    mcp_reload_confirmation_disabled: config.exists ? /mcp_reload_confirm\s*:\s*false/.test(text) : undefined,
    skill_path: skillPath,
    skill_installed: skillExists,
    direct_tool_prefix: "mcp_apple_health_",
    expected_direct_tools: HERMES_DIRECT_TOOLS
  };
  return { ...check, recommendations: buildHermesRecommendations(check) };
}

async function readOptionalText(path: string): Promise<{ exists: boolean; text?: string }> {
  try {
    return { exists: true, text: await fs.readFile(path, "utf8") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false };
    throw error;
  }
}

async function existsFile(path: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path);
    return stat.isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function buildHermesRecommendations(check: { config_exists: boolean; apple_health_server_configured: boolean; package_pinned: boolean; skill_installed: boolean; mcp_reload_confirmation_disabled?: boolean }) {
  const recommendations: string[] = [];
  if (!check.config_exists) recommendations.push("Run `apple-health-mcp-server setup --client hermes --export-path /path/to/export.xml` to create Hermes config and a local Hermes skill.");
  else if (!check.apple_health_server_configured) recommendations.push("Add an `apple_health` MCP server block to `~/.hermes/config.yaml`.");
  if (check.config_exists && check.apple_health_server_configured && !check.package_pinned) recommendations.push(`Pin Hermes MCP command to \`${PINNED_NPM_PACKAGE}\` to avoid stale npx cache behavior.`);
  if (!check.skill_installed) recommendations.push("Install the Hermes skill at `~/.hermes/skills/apple-health-mcp/SKILL.md`.");
  if (check.config_exists && check.mcp_reload_confirmation_disabled !== true) recommendations.push("Optional for lower friction: set `approvals.mcp_reload_confirm: false` if your Hermes policy allows MCP reload without confirmation.");
  recommendations.push("After Hermes config changes, use `/reload-mcp` or `hermes mcp test apple_health`; do not restart the gateway for normal Apple Health export access.");
  return recommendations;
}

function buildNextSteps(input: { nodeSupported: boolean; location: Awaited<ReturnType<typeof inspectExportLocation>> }) {
  const steps: string[] = [];
  if (!input.nodeSupported) steps.push("Install Node.js 20 or newer.");
  if (!input.location.exists) {
    steps.push("Set APPLE_HEALTH_EXPORT_PATH to export.xml, an Apple Health export directory, or export.zip.");
    steps.push("On iPhone: Health app > profile picture > Export All Health Data, then transfer the export to this machine.");
  }
  if (steps.length === 0) steps.push("Ready. Start with apple_health_daily_summary or apple_health_weekly_summary.");
  return steps;
}
