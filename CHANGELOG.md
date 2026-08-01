## 0.6.0 - 2026-08-01

### Fixed

- **`apple_health_list_records` reported statistics of the first page as if they described the whole query.** The `aggregate` block (`numeric.min/max/sum/average/count`, `count_by_type`, `date_range`, `units`) was computed only over the records that survived `limit` — 50 by default — while nothing in the payload said so. An agent asking for the minimum heart rate of a range with 800 matching records got the minimum of the 50 oldest ones: measured on a synthetic 800-record fixture, the tool answered `min: 120` when the true minimum was `85`, and `max: 159` when the true maximum was `175`. Wrong by construction, silently, on the default call with zero flags. The scan now keeps streaming past the cap and accumulates running statistics over **every** record matching the filter, while still returning at most `limit` records.
- **Daily/weekly summaries crashed on high-frequency days.** `Math.min(...values)` / `Math.max(...values)` in `summary.ts` exceeded the JS argument limit past ~120k values, so a day with that many heart-rate samples returned `Error: Maximum call stack size exceeded` instead of `heart.min_bpm` / `heart.max_bpm`. Both are now folds, and the same spread was removed from the record aggregator.

### Added

- **Truncation is now explicit in `apple_health_list_records`**: `limit_applied`, `truncated` (true when more records matched than the page could hold), `matched_count` (exact total matching the filter; omitted only when the scan stopped early because no aggregate was requested) and `aggregate_scope: "all_matching_records"`. `count` keeps its old meaning — the number of records in the returned listing. The markdown output (the default `response_format`) now carries the truncation flags plus `aggregate_min`/`aggregate_max`/`aggregate_average`, so the corrected numbers are visible without asking for JSON.
- `disclosure` in summary mode now reads `summary_mode_omits_individual_records_aggregate_covers_all_matching_records` when the aggregate came from the full scan.
- **`scanRecords()`** in `services/apple-health-export.ts` and **`createRecordAggregator()`** in `services/privacy.ts` — the streaming primitives behind the fix. `listRecords()` keeps its old signature and behavior.
- Regression gate `npm run test:aggregate` (`scripts/aggregate-truncation-test.mjs`), wired into `npm test`. It builds a synthetic 800-record export with the true min planted at index 750 and the true max at index 780 (both past the default limit), plus a synthetic 130k-record day for the `RangeError`. Both assertions fail on 0.5.1.

### Note

- The incremental cursor (`incremental_cache: true`) still only advances across records the caller actually received, so aggregating past the page never causes records to be skipped on the next call.

## 0.5.1 - 2026-07-30

### Added / Fixed

- clear/reimport mutation gate wording for scorecard 100.

# Changelog

## 0.5.0 - 2026-05-29

### Added

- **Watch-folder auto-reimport (no macOS required).** Point the connector at a folder via `APPLE_HEALTH_WATCH_PATH`, `~/.apple-health-mcp/config.json`, or `setup --watch-path <dir>`. When a newer Apple Health export appears there — `export.xml`, `export.zip`, an `apple_health_export/` directory, or any `*apple*health*.zip` — it is auto-promoted to the active export and the snapshot + incremental caches are cleared so the next summary reflects the new data. Reconciliation runs on server startup, live via filesystem events on long-running transports, and on demand. Turns the one-shot manual-export reader into a recurring-refresh workflow.
- **`apple_health_reimport` tool** for an explicit re-scan of the watch folder (`check_only: true` previews without promoting; `force: true` re-promotes the newest export to force a cache refresh). Tool count: 17 → 18.
- **`watch_folder` block + warning in `apple_health_connection_status`** reporting the watch path, whether the active export is the latest, the last watch-import timestamp, and a warning when a newer export is waiting to be imported.
- **`setup --watch-path <dir>`** persists the watch folder and immediately promotes any export already sitting in it.

### Note

- The native HealthKit bridge (live, no manual export) genuinely requires a macOS/iOS native component and remains out of scope for this Node MCP server.

## 0.4.3 - 2026-05-20

### Added

- **Incremental import cache** at `~/.apple-health-mcp/incremental-cache.json` (chmod 600). Persists the latest parsed timestamp per HealthKit category so repeated `apple_health_list_records` calls can skip already-seen records on large exports (1M+ records). Opt-in per call via `incremental_cache: true` (requires `type` filter). The cache is automatically invalidated when the export file mtime changes (signaling a fresh export from the Health app).
- **`apple_health_clear_incremental_cache` tool** for manual cache invalidation when you want to force a full re-parse without re-exporting from the iPhone. Tool count: 16 → 17.
- **`incremental_cache` block in `apple_health_connection_status`** showing cache existence, file size, last-update timestamp, tracked export mtime, and per-category last-parsed entries.

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
