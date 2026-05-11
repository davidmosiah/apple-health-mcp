# Changelog

## 0.3.0 - 2026-05-11

- Add `apple_health_quickstart` tool — personalized 3-step setup walkthrough adapted to current state (is `APPLE_HEALTH_EXPORT_PATH` set? does the export file exist and parse?). Returns cross-connector hints to pair with wellness-nourish, wellness-cycle-coach, and wellness-cgm-mcp, and emphasizes the local-first / no-cloud-API privacy posture.
- Add `apple_health_demo` tool — realistic Apple-Watch-style example payloads of `apple_health_daily_summary`, `apple_health_weekly_summary`, and `apple_health_wellness_context` so agents see the contract before parsing a real export (heart rate 72, steps 9341, sleep 7h12m, HRV 45 ms, ECG sinus rhythm).
- `recommended_first_calls` on the agent manifest now leads with `apple_health_quickstart` and `apple_health_demo`.
- Tool count: 10 → 12.

## 0.2.1

- Hardened HTTP smoke readiness.
- Documentation polish: README header in Beever-Atlas style, agent and contributor guides, Delx Wellness ecosystem cross-promo badges.

## 0.2.0

- Local-first MCP server for Apple Health `export.xml`, export directories, and `export.zip`.
- `apple_health_connection_status`, `apple_health_data_inventory`, `apple_health_daily_summary`, `apple_health_weekly_summary`, `apple_health_wellness_context`.
- `apple_health_list_records` and `apple_health_list_workouts` with bounded record/start/end filters.
- Privacy modes: `summary`, `structured`, `raw` with summary as the default.
- Hermes client-aware connection-status checks for `~/.hermes/config.yaml` and skill posture.
- MCP resources for agent manifest, capabilities, inventory and daily/weekly summaries.
- Local-config under `~/.apple-health-mcp/` with managed-exports directory.
