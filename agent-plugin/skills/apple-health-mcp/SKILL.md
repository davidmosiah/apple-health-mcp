---
name: apple-health-mcp
description: >-
  Read the user's Apple Health export (workouts, steps, heart rate, HRV, sleep, cycle tracking) through the local apple-health MCP server. Use when the user asks about Apple Health or iPhone/Apple Watch health records, daily or weekly summaries, or trends from their Health export. Starts with connection status and data inventory, uses synthetic demo data before an export is imported.
---

# Apple Health

MCP server `apple-health` from the `apple-health-mcp-unofficial@0.8.0` npm package, run locally through `npx`. It reads workouts, steps, heart rate, HRV, sleep, cycle tracking and other records from the iPhone Health export. Data source: no network service: it parses the user's own Apple Health export on disk.

## Workflow

1. Start with `apple_health_connection_status`. Then pick what fits the question: `apple_health_data_inventory`, `apple_health_daily_summary`, `apple_health_weekly_summary`.
2. If `apple_health_connection_status` reports the connector is not ready, call `apple_health_demo` for clearly labelled synthetic data so the user sees the shape of the answer, then give them the setup commands below to run in their own terminal.
3. Lead with the answer to the user's question, then the two or three numbers that support it, with dates. Say when data is missing or stale instead of filling gaps.

## Setup (the user runs this in a terminal, not in chat)

```bash
npx -y apple-health-mcp-unofficial@0.8.0 setup --auto-import --timezone <IANA zone>
npx -y apple-health-mcp-unofficial@0.8.0 doctor
```

Export first on the iPhone (Health → profile → Export All Health Data) and copy export.zip to this machine. `setup --import <path>` takes an explicit file instead of `--auto-import`, and `--watch-path <dir>` re-imports newer exports dropped in a folder.

## Safety

- Never ask the user to paste client secrets, passwords, tokens or MFA codes into the chat; setup happens in their terminal.
- Tools that change local state: apple_health_profile_update (local profile only), apple_health_reimport (re-reads the local export). Use them only when the user asks.
- Destructive: apple_health_clear_incremental_cache (clears the local parsed cache). Confirm with the user first.
- No live sync: data is as fresh as the last export the user imported.
- Not medical advice: the data supports personal reflection and planning, not diagnosis or treatment. Point the user to a clinician for symptoms, medication or anything urgent.
