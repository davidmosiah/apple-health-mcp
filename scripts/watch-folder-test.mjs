import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Isolated HOME so the test never touches a real ~/.apple-health-mcp config/cache.
const fakeHome = mkdtempSync(join(tmpdir(), 'apple-health-mcp-watch-test-'));
const watchDir = join(fakeHome, 'health-watch');
mkdirSync(watchDir, { recursive: true });

const fixtureXml = resolve('fixtures/apple_health_export/export.xml');
const watchedExport = join(watchDir, 'export.xml');

function spawnClient() {
  const client = new Client({ name: 'apple-health-watch-test', version: '0.0.0' });
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    // No APPLE_HEALTH_EXPORT_PATH: the active export must come from the watch folder.
    env: { ...process.env, HOME: fakeHome }
  });
  return { client, transport };
}

async function withClient(fn) {
  const { client, transport } = spawnClient();
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

function setMtimeNewerThan(path, referenceMs, bumpMs = 5000) {
  const future = new Date(referenceMs + bumpMs);
  utimesSync(path, future, future);
}

// 1. Run `setup --watch-path` (no export in the folder yet) to persist the watch config.
//    setup is a CLI command (not an MCP tool), so drive dist/index.js directly.
const { execFileSync } = await import('node:child_process');
const setupOut = execFileSync('node', [
  'dist/index.js', 'setup',
  '--watch-path', watchDir,
  '--home-dir', fakeHome,
  '--timezone', 'America/Fortaleza',
  '--json'
], { encoding: 'utf8', env: { ...process.env, HOME: fakeHome } });
const setupJson = JSON.parse(setupOut);
assert.equal(setupJson.ok, true, 'setup should succeed');
assert.equal(setupJson.watch_path, watchDir, 'setup should persist the watch path');
assert.ok(!setupJson.watch_reimport?.changed, 'no export in folder yet -> nothing promoted');

const config1 = JSON.parse(readFileSync(join(fakeHome, '.apple-health-mcp', 'config.json'), 'utf8'));
assert.equal(config1.APPLE_HEALTH_WATCH_PATH, watchDir, 'config persists watch path');
assert.equal(config1.APPLE_HEALTH_EXPORT_PATH, undefined, 'no active export yet');

// 2. With watch folder empty, summary tools report "export not found".
await withClient(async (client) => {
  const status = await client.callTool({ name: 'apple_health_connection_status', arguments: { response_format: 'json' } });
  assert.equal(status.structuredContent?.watch_folder?.configured, true, 'status exposes watch_folder block');
  assert.equal(status.structuredContent?.watch_folder?.watch_path_exists, true);
  assert.equal(status.structuredContent?.ready_for_apple_health_export, false, 'no export available yet');

  const check = await client.callTool({ name: 'apple_health_reimport', arguments: { check_only: true, response_format: 'json' } });
  assert.equal(check.structuredContent?.configured, true);
  assert.equal(check.structuredContent?.latest_export, undefined, 'no export in folder for check_only');

  const reimport = await client.callTool({ name: 'apple_health_reimport', arguments: { response_format: 'json' } });
  assert.equal(reimport.structuredContent?.changed, false);
  assert.equal(reimport.structuredContent?.reason, 'no_export_in_folder');
});

// 3. Drop the fixture export into the watch folder. A FRESH server process should
//    auto-promote it at startup (runStdio's reconcileWatchOnStart) with no manual call.
copyFileSync(fixtureXml, watchedExport);
await withClient(async (client) => {
  // No reimport call yet: prove the startup auto-reimport already made the export active.
  const status = await client.callTool({ name: 'apple_health_connection_status', arguments: { response_format: 'json' } });
  assert.equal(status.structuredContent?.ready_for_apple_health_export, true, 'startup auto-reimport promoted the dropped export');
  assert.equal(status.structuredContent?.config?.export_path, watchedExport, 'active export is now the watched file');
  assert.equal(status.structuredContent?.watch_folder?.active_export_is_latest, true);

  // 4. The summary tools must reflect the auto-promoted export's data.
  const daily = await client.callTool({
    name: 'apple_health_daily_summary',
    arguments: { date: '2026-05-01', timezone: 'America/Fortaleza', response_format: 'json' }
  });
  assert.equal(daily.structuredContent?.date, '2026-05-01');
  assert.equal(daily.structuredContent?.totals?.steps, 4000, 'daily summary reflects watched export step count');
  assert.equal(daily.structuredContent?.heart?.resting_bpm, 58);

  // An explicit reimport with no folder change is a no-op (idempotent).
  const reimport = await client.callTool({ name: 'apple_health_reimport', arguments: { response_format: 'json' } });
  assert.equal(reimport.structuredContent?.changed, false);
  assert.equal(reimport.structuredContent?.reason, 'already_current');
});

// Confirm the active export was persisted to config (survives across processes).
const config2 = JSON.parse(readFileSync(join(fakeHome, '.apple-health-mcp', 'config.json'), 'utf8'));
assert.equal(config2.APPLE_HEALTH_EXPORT_PATH, watchedExport, 'promotion persisted to config');
assert.ok(config2.APPLE_HEALTH_LAST_WATCH_IMPORT_AT, 'last watch import timestamp recorded');

// 5. Drop a DIFFERENT, newer export (changed step value) and confirm the summary
//    reflects the NEW data — proving a real reparse, not a stale snapshot cache.
const modifiedXml = readFileSync(fixtureXml, 'utf8')
  // Change the two 2026-05-01 step records (1250 + 2750 = 4000) to (1000 + 2000 = 3000).
  .replace('value="1250"', 'value="1000"')
  .replace('value="2750"', 'value="2000"');
writeFileSync(watchedExport, modifiedXml);
// Ensure the new file's mtime is strictly newer so the candidate is detected as fresher.
setMtimeNewerThan(watchedExport, statSync(watchedExport).mtimeMs);

await withClient(async (client) => {
  // Startup reconcile (runStdio) should already have promoted the updated export,
  // but call reimport explicitly to assert the transition reason deterministically.
  const reimport = await client.callTool({ name: 'apple_health_reimport', arguments: { force: true, response_format: 'json' } });
  assert.equal(reimport.structuredContent?.changed, true, 'force reimport refreshes the updated export');

  const daily = await client.callTool({
    name: 'apple_health_daily_summary',
    arguments: { date: '2026-05-01', timezone: 'America/Fortaleza', response_format: 'json' }
  });
  assert.equal(daily.structuredContent?.totals?.steps, 3000, 'summary reflects the UPDATED export (reparse, not stale cache)');
});

console.log(JSON.stringify({ ok: true, watch_folder: true, scenarios: 5 }, null, 2));
