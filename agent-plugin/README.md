# Apple Health — Agent Plugins package

Portable [Agent Plugins](https://agent-plugins.org/) v1 package for
[Hermes Agent](https://github.com/NousResearch/hermes-agent) and other Agent Plugins clients:
the `apple-health` MCP server (`apple-health-mcp-unofficial@0.8.0` over stdio) plus the `apple-health-mcp` workflow skill.

## Install (Hermes Agent)

```bash
hermes plugins install davidmosiah/apple-health-mcp/agent-plugin --no-enable
hermes plugins enable apple-health-mcp
```

Requires Node.js 20+ (`npx` on PATH). The skill loads as `apple-health-mcp:apple-health-mcp`.

## Connector setup

```bash
npx -y apple-health-mcp-unofficial@0.8.0 setup --auto-import --timezone <IANA zone>
npx -y apple-health-mcp-unofficial@0.8.0 doctor
```

Export first on the iPhone (Health → profile → Export All Health Data) and copy export.zip to this machine. `setup --import <path>` takes an explicit file instead of `--auto-import`, and `--watch-path <dir>` re-imports newer exports dropped in a folder.

## Disclosure

Runs the `apple-health-mcp-unofficial@0.8.0` npm package locally over stdio through `npx` (Node.js 20+ required); the package is downloaded from npm on first start. Data source: no network service: it parses the user's own Apple Health export on disk. Tools that change state: apple_health_profile_update (local profile only); apple_health_reimport (re-reads the local export); apple_health_clear_incremental_cache (clears the local parsed cache). No live sync: data is as fresh as the last export the user imported. The tool set comes from the pinned npm version, not from this repository's source tree.
