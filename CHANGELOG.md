# Changelog

## 0.4.2 - 2026-05-19

### Added

- **`apple_health_export_freshness` workflow tool.** Returns the local export file mtime, `days_since_export`, an `is_stale` flag, and a `recommendation` string. Considered stale when the export is older than 30 days, or older than 7 days with no recent records (the inventory's latest-record date also older than 7 days). Useful before relying on summary/wellness-context calls. Tool count: 15 → 16.
- **Stale-export warning surfaced inside `apple_health_connection_status`.** When the export is stale, `connection_status` now returns an `export_freshness` block (`days_since_export`, `is_stale`, `stale_reason`, `recommendation`) and a `warnings: [...]` array so agents can flag this without an extra round-trip.

## 0.4.1 - 2026-05-11

### Fixed

- **Profile-store regex no longer false-positives on common wellness words.** Split `SECRET_PATTERNS` into `SECRET_KEY_PATTERNS` (broad, for field names like `oauth_token`) and `SECRET_VALUE_PATTERNS` (high-specificity, only credential shapes: JWTs, `Bearer <token>`, `sk_live_`, `sk-proj-`, `xoxb-`, `github_pat_`, raw `Authorization:` headers). Previously legitimate text like "5 training sessions per week", "limit cookies", "I need to refresh my approach", or "secret sauce: more sleep" was rejected.
- **Partial-profile reads no longer crash downstream.** `readProfileFile` now structurally merges with `DEFAULT_PROFILE` when legacy Hermes/OpenClaw files lacked sub-objects. Previously `buildProfileSummary` and `missingCriticalFields` would throw.
- **Onboarding `privacy_note` no longer hard-codes a single connector path.** Lists multiple example paths so the message reads correctly from every connector.

## 0.4.0 - 2026-05-11

- Add shared Delx Wellness profile support. Vendored copy of the canonical `profile-store` (delx-wellness commit ab83d1a) at `src/services/profile-store.ts` reads and writes `~/.delx-wellness/profile.json` — a single source of truth for preferred name, goals, devices, training/nutrition/exercise/agent preferences and safety flags shared across every Delx Wellness MCP connector. Local-export connector: this profile is the only piece of cross-connector context — neither cloud tokens nor health data leave disk.
- Add `apple_health_profile_get` — read-only return of the current shared profile plus a summary and missing-critical fields.
- Add `apple_health_profile_update` — partial-patch writer. Requires `explicit_user_intent=true` (otherwise returns USER_ACTION_REQUIRED). Rejects secret-like fields at write time.
- Add `apple_health_onboarding` — read-only 11-question onboarding flow (en / pt-BR) plus current profile state and cross-connector hint.
- Add `apple-health-mcp-server onboarding` CLI command — emits flow JSON to stdout and a TTY-gated Markdown summary to stderr.
- `recommended_first_calls` on the agent manifest now leads with `apple_health_profile_get`.
- Tool count: 12 → 15.

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
