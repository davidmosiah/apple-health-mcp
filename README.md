# apple-health-mcp-server

[![MCP Compatible](https://img.shields.io/badge/MCP-compatible-7C3AED?style=flat-square)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](https://opensource.org/licenses/MIT)

Unofficial local-first MCP server for Apple Health export data.

Delx Wellness registry: <https://github.com/davidmosiah/delx-wellness>

> This connector reads Apple Health export files such as `export.xml` or `export.zip`. It does not provide live HealthKit access. A native iOS HealthKit bridge is a separate future component.

## What It Does

- Reads local Apple Health `export.xml`, export directories, or `export.zip`.
- Lists bounded Apple Health records by type/date.
- Lists workouts.
- Builds daily and weekly summaries for activity, heart, sleep and workouts.
- Exposes an agent manifest for Hermes/OpenClaw-style runtimes.
- Keeps health exports local; agents should never ask users to paste raw exports into chat.

## Install

```bash
npx -y apple-health-mcp-unofficial doctor
```

For MCP clients, use the package with no subcommand so it starts the MCP stdio server.

## Export Apple Health Data

On iPhone:

1. Open Health.
2. Tap your profile picture.
3. Tap Export All Health Data.
4. Transfer the exported zip to this machine.

Then configure:

```bash
npx -y apple-health-mcp-unofficial setup --export-path /path/to/export.zip
npx -y apple-health-mcp-unofficial doctor
```

Supported paths:

- `/path/to/export.xml`
- `/path/to/apple_health_export/`
- `/path/to/export.zip`

Environment variable alternative:

```bash
export APPLE_HEALTH_EXPORT_PATH="/path/to/export.xml"
```

## MCP Client Config

```json
{
  "mcpServers": {
    "apple_health": {
      "command": "npx",
      "args": ["-y", "apple-health-mcp-unofficial"]
    }
  }
}
```

Hermes:

```bash
npx -y apple-health-mcp-unofficial setup --client hermes --export-path /path/to/export.zip
apple-health-mcp-server doctor --client hermes
```

Then reload MCP with `/reload-mcp` or `hermes mcp test apple_health`.

## Tools

- `apple_health_agent_manifest`
- `apple_health_capabilities`
- `apple_health_connection_status`
- `apple_health_privacy_audit`
- `apple_health_list_records`
- `apple_health_list_workouts`
- `apple_health_daily_summary`
- `apple_health_weekly_summary`

## Resources

- `apple-health://agent-manifest`
- `apple-health://capabilities`
- `apple-health://summary/daily`
- `apple-health://summary/weekly`

## Privacy

Apple Health exports are sensitive health data. Keep them local. Do not commit them, upload them to issues, or paste raw export XML into chat.

This project is not a medical device and does not provide diagnosis, treatment or emergency monitoring.

## Development

```bash
npm install
npm test
```

Run locally:

```bash
npm run build
node dist/index.js
```

Optional local HTTP transport:

```bash
APPLE_HEALTH_MCP_TRANSPORT=http APPLE_HEALTH_MCP_PORT=3000 node dist/index.js
curl http://127.0.0.1:3000/health
```
