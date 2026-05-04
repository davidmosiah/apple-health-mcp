import { SERVER_VERSION } from "../constants.js";
import { parseAgentClientName } from "../services/agent-manifest.js";
import { buildConnectionStatus } from "../services/connection-status.js";
import { runSetupCommand } from "./setup.js";

export async function runCliCommand(args: string[]): Promise<number | undefined> {
  const [command, ...rest] = args;
  if (!command || command === "--http") return undefined;
  if (command === "setup") return runSetupCommand(rest);
  if (command === "doctor" || command === "status") return runDoctor(rest);
  if (command === "version" || command === "--version" || command === "-v") {
    console.log(SERVER_VERSION);
    return 0;
  }
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }
  if (!command.startsWith("--")) {
    console.error(`Unknown command: ${command}`);
    printHelp();
    return 1;
  }
  return undefined;
}

async function runDoctor(args: string[]): Promise<number> {
  const options = parseDoctorOptions(args);
  const status = await buildConnectionStatus({ client: options.client });
  if (options.json) console.log(JSON.stringify(status, null, 2));
  else printDoctor(status);
  return options.strict && !status.ok ? 1 : 0;
}

function parseDoctorOptions(args: string[]) {
  let client: ReturnType<typeof parseAgentClientName> | undefined;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--client") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("Missing value for --client.");
      client = parseAgentClientName(value);
      index += 1;
    }
  }
  return {
    json: args.includes("--json"),
    strict: args.includes("--strict"),
    client
  };
}

function printDoctor(status: Awaited<ReturnType<typeof buildConnectionStatus>>): void {
  console.log("Apple Health MCP Doctor");
  console.log(`Status: ${status.ok ? "ready" : "needs export"}`);
  if (status.client) console.log(`Client: ${status.client}`);
  console.log("");
  console.log("Checks:");
  console.log(`- Node.js >=20: ${status.node.supported ? "ok" : `needs update (${status.node.version})`}`);
  console.log(`- Export path: ${status.export.exists ? `${status.export.kind} at ${status.export.export_xml_path ?? status.export.resolved_path}` : "missing"}`);
  console.log(`- Privacy mode: ${status.config.privacy_mode}`);
  if (status.client_checks?.hermes) {
    const hermes = status.client_checks.hermes;
    console.log("- Hermes config:");
    console.log(`  path: ${hermes.config_path}`);
    console.log(`  configured: ${hermes.apple_health_server_configured ? "ok" : "missing"}`);
    console.log(`  pinned package: ${hermes.package_pinned ? "ok" : "missing"}`);
    console.log(`  skill: ${hermes.skill_installed ? hermes.skill_path : "missing"}`);
  }
  console.log("");
  console.log("Next steps:");
  status.next_steps.forEach((step, index) => console.log(`${index + 1}. ${step}`));
}

function printHelp(): void {
  console.log(`Apple Health MCP Server

Usage:
  apple-health-mcp-server                                Start MCP stdio server
  apple-health-mcp-server --http                         Start local HTTP MCP server
  apple-health-mcp-server setup --export-path <path>     Save local export path and client config
  apple-health-mcp-server setup --client hermes          Save Hermes config and skill
  apple-health-mcp-server doctor                         Check setup and next steps
  apple-health-mcp-server doctor --client hermes --json  Check Hermes setup as JSON

Required data:
  APPLE_HEALTH_EXPORT_PATH=/path/to/export.xml

This connector reads Apple Health export files. It does not provide live HealthKit access.
`);
}
