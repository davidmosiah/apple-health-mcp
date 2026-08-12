<!-- delx-wellness header v2 -->
<h1 align="center">Apple Health MCP</h1>

<div align="center">
  <img src="assets/banner.png" alt="Apple Health MCP — Apple Health MCP for AI agents" width="85%" />
</div>

<h3 align="center">
  Give your AI agent your Apple Health activity, sleep, HRV and workouts &mdash; from your local export.zip.<br>
  Local-first MCP server &mdash; <strong>tokens never leave your machine</strong>.
</h3>

<p align="center">
  <a href="https://www.npmjs.com/package/apple-health-mcp-unofficial"><img src="https://img.shields.io/npm/v/apple-health-mcp-unofficial?style=for-the-badge&labelColor=0F172A&color=10B981&logo=npm&logoColor=white" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/apple-health-mcp-unofficial"><img src="https://img.shields.io/npm/dm/apple-health-mcp-unofficial?style=for-the-badge&labelColor=0F172A&color=0EA5A3&logo=npm&logoColor=white" alt="npm downloads" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/LICENSE-MIT-22C55E?style=for-the-badge&labelColor=0F172A" alt="License MIT" /></a>
  <a href="https://wellness.delx.ai/connectors/apple-health"><img src="https://img.shields.io/badge/SITE-wellness.delx.ai-0EA5A3?style=for-the-badge&labelColor=0F172A" alt="Site" /></a>
</p>

<p align="center">
  <a href="https://github.com/davidmosiah/apple-health-mcp/stargazers"><img src="https://img.shields.io/github/stars/davidmosiah/apple-health-mcp?style=for-the-badge&labelColor=0F172A&color=FBBF24&logo=github" alt="GitHub stars" /></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/BUILT_FOR-MCP-7C3AED?style=for-the-badge&labelColor=0F172A" alt="Built for MCP" /></a>
  <a href="https://github.com/davidmosiah/delx-wellness-hermes"><img src="https://img.shields.io/badge/HERMES-one--command_setup-10B981?style=for-the-badge&labelColor=0F172A" alt="Hermes one-command setup" /></a>
  <a href="https://github.com/davidmosiah/delx-wellness"><img src="https://img.shields.io/badge/Apple%20Health-FA243C?style=for-the-badge&labelColor=0F172A&logoColor=white&logo=apple&logoColor=white" alt="Apple Health" /></a>
</p>

> ⚡ **One-command install** with [Delx Wellness for Hermes](https://github.com/davidmosiah/delx-wellness-hermes):
> `npx -y delx-wellness-hermes setup` &mdash; preconfigures this connector and the other 8 in a dedicated Hermes profile.
>
> Or wire it standalone into Claude Desktop / Cursor / ChatGPT Desktop &mdash; see the install section below.

---

## HTTP (v2 stateless)

Default is **stdio**. Optional Streamable HTTP — no session id, JSON responses, loopback only:

```bash
npx -y apple-health-mcp-unofficial --http
# GET  http://127.0.0.1:3000/health
# POST http://127.0.0.1:3000/mcp   (sessionless)
```

Env: `APPLE_HEALTH_MCP_HOST`, `APPLE_HEALTH_MCP_PORT`, `APPLE_HEALTH_MCP_TRANSPORT=http`.


<!-- /delx-wellness header v2 -->

**Local-first MCP server that reads your Apple Health export and exposes it to AI agents.**

> **Unofficial project.** Not affiliated with, endorsed by or supported by Apple Inc. Apple Health is a trademark of Apple Inc. This package reads exports you generate yourself from the Apple Health app.

> **No live HealthKit access.** This connector reads `export.xml` / `export.zip` files exported from your iPhone. A native iOS HealthKit bridge is a separate future component.

Built by [David Mosiah](https://github.com/davidmosiah) for people who use Claude, Cursor, Hermes, OpenClaw or other MCP-compatible agents to think about long-term health and activity trends — without copy-pasting numbers from the Health app.

Part of [Delx Wellness](https://github.com/davidmosiah/delx-wellness), a registry of local-first wellness MCP connectors.

> If this connector helps your agent workflow, please star the repo. Stars make the project easier for other AI builders to discover and help Delx keep shipping local-first wellness infrastructure.

## Why this exists

Apple Health is the most complete personal health dataset most people own — years of activity, heart rate, sleep, workouts, body measurements, even ECGs. But Apple does not expose a public cloud API. The data lives on the iPhone behind HealthKit, and the only practical way to bring it off-device today is the **Health Export** feature inside the Health app.

This package reads that export locally — either the raw `export.xml`, the unzipped folder, or the `export.zip` — and exposes Apple Health through the Model Context Protocol. No tokens, no OAuth, no cloud sync. The export never leaves your machine.

## Setup in 60 seconds

**1. Export your Apple Health data on iPhone:**

```text
Health app → tap your profile picture → Export All Health Data
```

Wait a few minutes. AirDrop or transfer the zip to this machine.

**2. Configure and verify:**

```bash
npx -y apple-health-mcp-unofficial setup --export-path /path/to/export.zip
npx -y apple-health-mcp-unofficial doctor
```

Or let the CLI find the newest local export in `Downloads`, `Desktop` or `Documents`, copy it into managed local storage, and save that path:

```bash
npx -y apple-health-mcp-unofficial setup --auto-import
```

Supported export paths:
- `/path/to/export.zip`
- `/path/to/apple_health_export/` (unzipped folder)
- `/path/to/export.xml` (raw export file)

**Keep it fresh — watch a folder (no macOS needed):**

Apple Health is a manual export, so the usual pain is that your data goes stale the moment you stop re-running setup. Point the connector at a folder you drop new exports into:

```bash
npx -y apple-health-mcp-unofficial setup --watch-path /path/to/health-exports
```

Now every time you export from your iPhone and drop the new `export.zip` (or `export.xml`, or unzipped `apple_health_export/`) into that folder, the connector auto-promotes the newest one to be the active export — on server startup and live while it runs — and refreshes the cached summaries. You can also trigger a re-scan on demand with the `apple_health_reimport` tool. This is the cross-platform recurring-refresh path; a fully live HealthKit bridge still needs a native macOS/iOS component.

Then add this to your MCP client config:

<!-- config-example -->

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

For Claude Desktop, run `setup --client claude --export-path /path/to/export.zip` and the snippet is written for you.

## Try it with your agent

Three things to ask first:

```text
Use apple_health_connection_status to check setup, then run apple_health_daily_summary.
Give me a 5-line wellness brief for today.
```

```text
Call apple_health_data_inventory first. What Apple Health signals and date ranges
are available in this export?
```

```text
Call apple_health_weekly_summary with response_format=json. Compare steps,
sleep, workouts and heart signals across the last 7 days.
```

```text
Use the apple_health_weekly_review prompt, days=14.
Find the biggest habit pattern and suggest one experiment.
```

## Data availability

This package parses Apple Health exports from the Health app. When this README says `raw`, it means the upstream XML record fields — not raw HealthKit data.

| Data | Available | Notes |
|---|:---:|---|
| Activity (steps, distance, energy, exercise) | ✓ | Standard `HKQuantityType` records |
| Heart rate (resting + samples) | ✓ | Recorded HR samples and resting HR |
| Sleep analysis + sleep stages | ✓ | When iPhone/Watch logs sleep |
| Workouts + sport metadata | ✓ | All `HKWorkout` entries |
| Body measurements (weight, BMI, body fat) | ✓ | When the user logs them |
| HRV (SDNN) + breathing rate | ✓ | When Watch supports them |
| ECG records | ✓ (metadata) | Apple Watch ECG events; raw waveform requires PDF export |
| Live HealthKit access | — | Apple does not expose a public live API |
| iCloud Health sync | — | Not exposed by export files |

## Tools

**Start with these:**

- `apple_health_connection_status` — verify export path before reading data
- `apple_health_data_inventory` — discover available record types, date coverage, sources count and stale export risk
- `apple_health_daily_summary` — daily wellness brief from export data
- `apple_health_weekly_summary` — weekly comparison and habit signals

**Diagnostics**

- `apple_health_capabilities`, `apple_health_agent_manifest`, `apple_health_privacy_audit`

**Records**

- `apple_health_list_records` — bounded records by `type` (e.g. `HKQuantityTypeIdentifierStepCount`), `start`, `end`, `limit`. `limit` caps the returned **list** only: in the default `summary` privacy mode the `aggregate` block (<!-- record-aggregate-keys:start -->`count_by_type`, `units`, `date_range`, `numeric`<!-- record-aggregate-keys:end -->) is computed over every record matching the filter, and `truncated` / `limit_applied` / `matched_count` tell you whether the list itself was cut. The statistics live **under `numeric`** (`numeric.min` / `numeric.max` / `numeric.sum` / `numeric.average` / `numeric.count`), not at the top of `aggregate` — see [What a payload looks like](#what-a-payload-looks-like)
- `apple_health_list_workouts` — bounded workouts by `start`, `end`, `limit`. Same contract: `limit` caps the returned **list** only, and in `summary` privacy mode the `aggregate` totals (<!-- workout-aggregate-keys:start -->`count_by_activity`, `date_range`, `total_duration_minutes`, `total_distance`, `distance_units`, `total_energy_kcal`, `workout_count`<!-- workout-aggregate-keys:end -->) cover every workout matching the filter, with `truncated` / `limit_applied` / `matched_count` reporting whether the list was cut

**Keeping data fresh**

- `apple_health_reimport` — re-scan the watch folder (`APPLE_HEALTH_WATCH_PATH`) and promote the newest export, refreshing summaries; pass `check_only: true` to preview without promoting

### What a list call costs

`limit` bounds the **output**, not the work. In the default `summary` privacy mode the aggregate has to describe every matching record, so the scan cannot stop at the cap — it streams `export.xml` to the end. Narrowing with `type`, `start` or `end` does **not** shorten it: a match could still sit in the last byte, so the file is read in full either way.

Measured on synthetic exports (Node 23, macOS, warm page cache), for one `apple_health_list_records` call in summary mode:

| export.xml | first call, summary mode | same call repeated | same call, `privacy_mode: "raw"` |
|---|---|---|---|
| 84 MB (353k records) | ~3.0 s | <1 ms | ~1 ms |
| 336 MB (1.4M records) | ~11.3 s | <1 ms | ~2 ms |

Roughly **33 ms per MB**, linear in file size. A cold first read of a large export — before the OS has the file cached — costs noticeably more (~29 s was observed for 336 MB).

Practical guidance:

- **Identical repeat queries are free.** Results are memoized in memory per export file, keyed on path + size + mtime. Promoting a new export (or `apple_health_reimport`) invalidates them, so a stale export is never served.
- **`apple_health_daily_summary`, `apple_health_weekly_summary` and `apple_health_data_inventory` share a separate snapshot cache** and were already paying one full parse; they are not affected by this.
- **Need a quick page rather than statistics?** `privacy_mode: "structured"` or `"raw"` stops the scan at `limit` and returns in about a millisecond — at the cost of returning individual records instead of an aggregate.
- **`apple_health_list_workouts` reaches the end of the file in every mode**, because workouts are sparse: an export rarely holds enough `Workout` elements to fill even the default page of 50.
- `incremental_cache: true` is never memoized — it advances a persistent per-category cursor, so each call must actually run.

### What a payload looks like

Synthetic values, real shape. `npm run test:readme-contract` calls the actual server against the repo fixture and fails if any key below stops existing — or if the server starts returning a key this section does not show.

<!-- payload-example: apple_health_list_records {"type":"HKQuantityTypeIdentifierHeartRate","response_format":"json"} -->

```json
{
  "source": "apple_health_export",
  "type": "HKQuantityTypeIdentifierHeartRate",
  "privacy_mode": "summary",
  "count": 50,
  "limit_applied": 50,
  "truncated": true,
  "matched_count": 2847,
  "records": [],
  "aggregate": {
    "count_by_type": { "HKQuantityTypeIdentifierHeartRate": 2847 },
    "units": ["count/min"],
    "date_range": {
      "first": "2026-04-01T03:12:00.000Z",
      "last": "2026-04-30T23:41:00.000Z",
      "first_date": "2026-04-01",
      "last_date": "2026-04-30"
    },
    "numeric": { "count": 2847, "sum": 202137, "average": 71, "min": 48, "max": 174 }
  },
  "aggregate_scope": "all_matching_records",
  "disclosure": "summary_mode_omits_individual_records_aggregate_covers_all_matching_records"
}
```

`records` is empty in `summary` mode by design — the aggregate replaces the individual samples. `count` still reports how many records the scan paged in; `matched_count` is the full match set the aggregate covers.

<!-- payload-example: apple_health_list_workouts {"response_format":"json"} -->

```json
{
  "source": "apple_health_export",
  "privacy_mode": "summary",
  "count": 12,
  "limit_applied": 50,
  "truncated": false,
  "matched_count": 12,
  "workouts": [],
  "aggregate": {
    "count_by_activity": {
      "HKWorkoutActivityTypeRunning": 8,
      "HKWorkoutActivityTypeTraditionalStrengthTraining": 4
    },
    "date_range": {
      "first": "2026-04-02T21:10:00.000Z",
      "last": "2026-04-29T22:05:00.000Z",
      "first_date": "2026-04-02",
      "last_date": "2026-04-29"
    },
    "total_duration_minutes": 486.5,
    "total_distance": 62.4,
    "distance_units": ["km"],
    "total_energy_kcal": 5820,
    "workout_count": 12
  },
  "aggregate_scope": "all_matching_workouts",
  "disclosure": "summary_mode_omits_individual_workouts_aggregate_covers_all_matching_workouts"
}
```

## Prompts

- `apple_health_daily_review` — daily wellness review with non-medical framing
- `apple_health_weekly_review` — weekly habit signals and trend comparison

## Resources

- `apple-health://capabilities`, `apple-health://agent-manifest`
- `apple-health://inventory`, `apple-health://summary/daily`, `apple-health://summary/weekly`

## Privacy & security

- Apple Health exports are highly sensitive personal health data. Keep them local.
- Never commit `export.xml` / `export.zip` to GitHub, paste raw exports into chat, or upload them to issues.
- The export path is read-only; the MCP never modifies your export.
- `APPLE_HEALTH_PRIVACY_MODE` defaults to `summary` for this connector (more conservative than other Delx Wellness connectors) since the dataset is rich and sensitive. In summary mode, low-level list tools return aggregates instead of individual records. Raw record dumps are opt-in.
- This is **not medical advice**. The server exposes data you exported yourself for personal AI workflows, not diagnosis or emergency monitoring.

## Configuration

```bash
APPLE_HEALTH_EXPORT_PATH=/path/to/export.zip   # or export.xml or apple_health_export/
APPLE_HEALTH_PRIVACY_MODE=summary              # summary | structured | raw
APPLE_HEALTH_TIMEZONE=America/Fortaleza        # local-day summaries; defaults to UTC unless setup saves a timezone
APPLE_HEALTH_WATCH_PATH=/path/to/health-exports # optional: auto-reimport the newest export dropped here
```

`setup` writes these settings into `~/.apple-health-mcp/config.json` with `0600` permissions.

`setup --auto-import` scans common local folders for the newest Apple Health export and copies it to `~/.apple-health-mcp/exports/` with `0600` permissions. This automates the local import step after you transfer the export from the iPhone. Fully live HealthKit sync still requires a separate native bridge; this Node MCP intentionally reads local exports only.

`setup --watch-path <dir>` (or `APPLE_HEALTH_WATCH_PATH`) makes the connector treat a folder as a drop zone. On startup, while running (via filesystem events), and whenever the `apple_health_reimport` tool is called, it promotes the newest Apple Health export found there — `export.xml`, `export.zip`, an `apple_health_export/` directory, or any `*apple*health*.zip` — to be the active export and clears the snapshot + incremental caches so the next summary reflects the new data. `apple_health_connection_status` reports the watch folder state and warns when a newer export is waiting.

## Hermes / remote setup

```bash
npx -y apple-health-mcp-unofficial setup --client hermes --export-path /path/to/export.zip
npx -y apple-health-mcp-unofficial doctor --client hermes
hermes mcp test apple_health
```

After Hermes config changes, use `/reload-mcp` or `hermes mcp test apple_health`. Don't restart the gateway for normal export access.

If the Hermes server runs on a different machine than your iPhone, transfer the export there and point `--export-path` at it. The export file should be `chmod 600`.

## Requirements

- Node.js 20+
- An Apple Health export from your iPhone (Health app → profile → Export All Health Data)

## Development

```bash
git clone https://github.com/davidmosiah/apple-health-mcp.git
cd apple-health-mcp
npm install
npm test
npm run build
```

Test with MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

Optional local HTTP transport:

```bash
APPLE_HEALTH_MCP_TRANSPORT=http APPLE_HEALTH_MCP_PORT=3000 node dist/index.js
curl http://127.0.0.1:3000/health
```

## Links

- npm: <https://www.npmjs.com/package/apple-health-mcp-unofficial>
- Docs site: <https://wellness.delx.ai/connectors/apple-health>
- GitHub: <https://github.com/davidmosiah/apple-health-mcp>
- Delx Wellness registry: <https://github.com/davidmosiah/delx-wellness>
- Connector quality standard: <https://github.com/davidmosiah/delx-wellness/blob/main/docs/connector-quality-standard.md>
- Apple Health export how-to: <https://support.apple.com/guide/iphone/share-health-and-fitness-data-iph27f6325b2/ios>

<!-- delx-wellness see-also -->

## See also

The full [Delx Wellness](https://wellness.delx.ai) connector library:

| Provider | Package | Repo |
|---|---|---|
| WHOOP | [`whoop-mcp-unofficial`](https://www.npmjs.com/package/whoop-mcp-unofficial) | [whoop-mcp](https://github.com/davidmosiah/whoop-mcp) |
| Oura | [`oura-mcp-unofficial`](https://www.npmjs.com/package/oura-mcp-unofficial) | [ouramcp](https://github.com/davidmosiah/ouramcp) |
| Garmin | [`garmin-mcp-unofficial`](https://www.npmjs.com/package/garmin-mcp-unofficial) | [garminmcp](https://github.com/davidmosiah/garminmcp) |
| Strava | [`strava-mcp-unofficial`](https://www.npmjs.com/package/strava-mcp-unofficial) | [strava-mcp](https://github.com/davidmosiah/strava-mcp) |
| Fitbit | [`fitbit-mcp-unofficial`](https://www.npmjs.com/package/fitbit-mcp-unofficial) | [fitbitmcp](https://github.com/davidmosiah/fitbitmcp) |
| Withings | [`withings-mcp-unofficial`](https://www.npmjs.com/package/withings-mcp-unofficial) | [withingsmcp](https://github.com/davidmosiah/withingsmcp) |
| Apple Health | [`apple-health-mcp-unofficial`](https://www.npmjs.com/package/apple-health-mcp-unofficial) | [apple-health-mcp](https://github.com/davidmosiah/apple-health-mcp) |
| Polar | [`polar-mcp-unofficial`](https://www.npmjs.com/package/polar-mcp-unofficial) | [polarmcp](https://github.com/davidmosiah/polarmcp) |
| Nourish (nutrition) | [`wellness-nourish`](https://www.npmjs.com/package/wellness-nourish) | [wellness-nourish](https://github.com/davidmosiah/wellness-nourish) |

**One-command setup for Hermes** — preconfigures every connector above plus wellness skills + onboarding: [`delx-wellness-hermes`](https://github.com/davidmosiah/delx-wellness-hermes).

<!-- /delx-wellness see-also -->

## 📧 Contact & Support

- 📨 **support@delx.ai** — general questions, integration help, partnerships
- 🐛 **Bug reports / feature requests** — [GitHub Issues](https://github.com/davidmosiah/apple-health-mcp/issues)
- 🐦 **Updates** — [@delx369](https://x.com/delx369) on X
- 🌐 **Site** — [wellness.delx.ai](https://wellness.delx.ai)


## License

MIT — see [LICENSE](LICENSE).

## Disclaimer

This software is provided as-is. It is not a medical device, does not provide medical advice, and should not be used for diagnosis, treatment or emergency monitoring. Always consult qualified professionals for medical concerns.
