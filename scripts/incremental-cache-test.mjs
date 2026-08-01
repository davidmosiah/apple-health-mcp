import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, mkdirSync, rmSync, statSync, utimesSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Use an isolated HOME so the test never touches a real ~/.apple-health-mcp cache.
const fakeHome = mkdtempSync(join(tmpdir(), 'apple-health-mcp-cache-test-'));
const cachePath = join(fakeHome, '.apple-health-mcp', 'incremental-cache.json');
const exportPath = resolve('fixtures/apple_health_export/export.xml');

async function newClient() {
  const client = new Client({ name: 'apple-health-incremental-cache-test', version: '0.0.0' });
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    env: {
      ...process.env,
      HOME: fakeHome,
      APPLE_HEALTH_EXPORT_PATH: exportPath
    }
  });
  await client.connect(transport);
  return client;
}

const client = await newClient();
try {
  // 1. Cache file does not exist before first use.
  assert.equal(existsSync(cachePath), false, 'cache file should not exist before first call');

  // Connection status should reflect that.
  const initialStatus = await client.callTool({
    name: 'apple_health_connection_status',
    arguments: { response_format: 'json' }
  });
  assert.equal(initialStatus.structuredContent?.incremental_cache?.exists, false);
  assert.equal(initialStatus.structuredContent?.incremental_cache?.category_count, 0);

  // 2. First list_records call with incremental_cache=true: seeds the cache.
  const first = await client.callTool({
    name: 'apple_health_list_records',
    arguments: {
      type: 'HKQuantityTypeIdentifierStepCount',
      limit: 50,
      incremental_cache: true,
      privacy_mode: 'raw',
      response_format: 'json'
    }
  });
  assert.equal(first.structuredContent?.count, 3, 'first call should return all 3 step records');
  assert.equal(existsSync(cachePath), true, 'cache file should be created');

  const cache1 = JSON.parse(readFileSync(cachePath, 'utf8'));
  assert.ok(cache1.categories?.HKQuantityTypeIdentifierStepCount, 'should persist last_parsed_at for the step category');
  assert.equal(typeof cache1.export_mtime_ms, 'number');
  assert.equal(typeof cache1.export_path, 'string');

  // 3. Second call with same cache: should skip already-parsed records.
  const second = await client.callTool({
    name: 'apple_health_list_records',
    arguments: {
      type: 'HKQuantityTypeIdentifierStepCount',
      limit: 50,
      incremental_cache: true,
      privacy_mode: 'raw',
      response_format: 'json'
    }
  });
  assert.equal(second.structuredContent?.count, 0, 'second call should skip all already-seen records');

  // 4. Connection status now shows the cache populated.
  const statusWithCache = await client.callTool({
    name: 'apple_health_connection_status',
    arguments: { response_format: 'json' }
  });
  assert.equal(statusWithCache.structuredContent?.incremental_cache?.exists, true);
  assert.ok(statusWithCache.structuredContent?.incremental_cache?.category_count >= 1);
  const stepEntry = statusWithCache.structuredContent?.incremental_cache?.categories
    ?.find((c) => c.category === 'HKQuantityTypeIdentifierStepCount');
  assert.ok(stepEntry, 'connection status should list the step category');
  assert.ok(stepEntry.last_parsed_at, 'step category should have a last_parsed_at');

  // 5. Without incremental_cache=true, behavior is unchanged (returns full set).
  const fullRescan = await client.callTool({
    name: 'apple_health_list_records',
    arguments: {
      type: 'HKQuantityTypeIdentifierStepCount',
      limit: 50,
      privacy_mode: 'raw',
      response_format: 'json'
    }
  });
  assert.equal(fullRescan.structuredContent?.count, 3, 'non-incremental call should still return all 3 records');

  // 6. mtime change invalidates the cache (simulates a fresh export from iPhone).
  const stat = statSync(exportPath);
  const futureTime = new Date(stat.mtimeMs + 5000);
  utimesSync(exportPath, futureTime, futureTime);

  const afterMtimeChange = await client.callTool({
    name: 'apple_health_list_records',
    arguments: {
      type: 'HKQuantityTypeIdentifierStepCount',
      limit: 50,
      incremental_cache: true,
      privacy_mode: 'raw',
      response_format: 'json'
    }
  });
  assert.equal(afterMtimeChange.structuredContent?.count, 3, 'mtime change should invalidate cache and re-parse');

  // 7. Clear-cache tool wipes the cache state.
  const clear = await client.callTool({
    name: 'apple_health_clear_incremental_cache',
    arguments: { response_format: 'json' }
  });
  assert.equal(clear.structuredContent?.ok, true);
  assert.equal(clear.structuredContent?.existed, true);

  const afterClear = await client.callTool({
    name: 'apple_health_list_records',
    arguments: {
      type: 'HKQuantityTypeIdentifierStepCount',
      limit: 50,
      incremental_cache: true,
      privacy_mode: 'raw',
      response_format: 'json'
    }
  });
  assert.equal(afterClear.structuredContent?.count, 3, 'after clear, should re-parse from beginning');

  // 8. getLastParsedAt for unknown category returns null (verified indirectly via behavior).
  const unknownCategoryStats = await client.callTool({
    name: 'apple_health_connection_status',
    arguments: { response_format: 'json' }
  });
  const unknownEntry = unknownCategoryStats.structuredContent?.incremental_cache?.categories
    ?.find((c) => c.category === 'HKQuantityTypeIdentifierNonExistentCategory');
  assert.equal(unknownEntry, undefined);

  console.log(JSON.stringify({ ok: true, incremental_cache: true, scenarios: 8 }, null, 2));
} finally {
  await client.close();
}

/**
 * 9. privacy_mode=summary + incremental_cache together.
 *
 * Every scenario above runs in raw mode, which is the one path where the scan stops at
 * `limit` and nothing walks past the cap. In summary mode the scan keeps reading past
 * the page to build the aggregate, while the cursor may only advance across records the
 * caller actually received — advance it over aggregated-but-unreturned records and the
 * next call silently skips them. That combination had no test, so a regression there
 * would have passed green while losing health records.
 *
 * Fixture: 120 synthetic step records, one per minute, values 1..120, paged at 50.
 * All data is synthetic; no real Apple Health export is read.
 */
const summaryHome = mkdtempSync(join(tmpdir(), 'apple-health-mcp-summary-cache-'));
const summaryExportDir = join(summaryHome, 'export');
const summaryExportPath = join(summaryExportDir, 'export.xml');
mkdirSync(summaryExportDir, { recursive: true });

const TOTAL = 120;
const PAGE = 50;
const sumRange = (from, to) => ((from + to) * (to - from + 1)) / 2;
const stampFor = (index) => {
  const hour = String(Math.floor(index / 60)).padStart(2, '0');
  const minute = String(index % 60).padStart(2, '0');
  return `2026-03-01 ${hour}:${minute}:00 -0300`;
};
const isoFor = (index) => {
  const hour = String(Math.floor(index / 60)).padStart(2, '0');
  const minute = String(index % 60).padStart(2, '0');
  return new Date(`2026-03-01T${hour}:${minute}:00-03:00`).toISOString();
};

let summaryXml = '<?xml version="1.0" encoding="UTF-8"?>\n<HealthData locale="en_US">\n';
for (let index = 0; index < TOTAL; index += 1) {
  const stamp = stampFor(index);
  summaryXml += `  <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Synthetic Watch" unit="count" creationDate="${stamp}" startDate="${stamp}" endDate="${stamp}" value="${index + 1}"/>\n`;
}
summaryXml += '</HealthData>\n';
writeFileSync(summaryExportPath, summaryXml);

const summaryClient = new Client({ name: 'apple-health-summary-cache-test', version: '0.0.0' });
await summaryClient.connect(new StdioClientTransport({
  command: 'node',
  args: ['dist/index.js'],
  env: { ...process.env, HOME: summaryHome, APPLE_HEALTH_EXPORT_PATH: summaryExportPath }
}));

try {
  const page = (n) => summaryClient.callTool({
    name: 'apple_health_list_records',
    arguments: {
      type: 'HKQuantityTypeIdentifierStepCount',
      limit: PAGE,
      incremental_cache: true,
      privacy_mode: 'summary',
      response_format: 'json'
    }
  }).then((result) => ({ n, payload: result.structuredContent }));

  const first = await page(1);
  assert.equal(first.payload?.count, PAGE, 'summary + cache: first page must return exactly `limit` records');
  assert.equal(first.payload?.matched_count, TOTAL, 'summary + cache: matched_count must cover every unseen record');
  assert.equal(first.payload?.truncated, true, 'summary + cache: first page must disclose truncation');
  assert.equal(first.payload?.aggregate?.numeric?.count, TOTAL, 'summary + cache: aggregate must cover every unseen record');
  assert.equal(first.payload?.aggregate?.numeric?.sum, sumRange(1, TOTAL), 'summary + cache: aggregate sum must cover records 1..120');
  assert.equal(first.payload?.aggregate?.date_range?.first, isoFor(0), 'summary + cache: aggregate must start at the oldest unseen record');

  // The cursor must have advanced by exactly one page — not past the records the
  // aggregate walked over but never returned.
  const second = await page(2);
  assert.equal(second.payload?.count, PAGE, 'summary + cache: second page must return the next 50 records, not skip them');
  assert.equal(second.payload?.matched_count, TOTAL - PAGE, 'summary + cache: second page must see exactly the records the first page did not return');
  assert.equal(
    second.payload?.aggregate?.numeric?.sum,
    sumRange(PAGE + 1, TOTAL),
    'summary + cache: second aggregate must cover records 51..120 — a drifting cursor changes this sum'
  );
  assert.equal(second.payload?.aggregate?.date_range?.first, isoFor(PAGE), 'summary + cache: second page must resume at record 51');

  const third = await page(3);
  assert.equal(third.payload?.count, TOTAL - 2 * PAGE, 'summary + cache: third page must return the remaining 20 records');
  assert.equal(third.payload?.truncated, false, 'summary + cache: the last page is not truncated');
  assert.equal(third.payload?.matched_count, TOTAL - 2 * PAGE, 'summary + cache: matched_count must be exact on the last page');
  assert.equal(
    third.payload?.aggregate?.numeric?.sum,
    sumRange(2 * PAGE + 1, TOTAL),
    'summary + cache: third aggregate must cover records 101..120'
  );

  const fourth = await page(4);
  assert.equal(fourth.payload?.count, 0, 'summary + cache: nothing is left after the whole set was paged');
  assert.equal(fourth.payload?.matched_count, 0, 'summary + cache: matched_count must be 0 once every record was returned');
  assert.equal(fourth.payload?.aggregate?.numeric, undefined, 'summary + cache: an empty match set has no numeric aggregate');

  // Every record was returned exactly once across the pages.
  assert.equal(
    first.payload.count + second.payload.count + third.payload.count + fourth.payload.count,
    TOTAL,
    'summary + cache: paging must return each record exactly once — no record may be skipped'
  );

  console.log(JSON.stringify({ ok: true, incremental_cache_summary_mode: true, records: TOTAL, pages: 4 }, null, 2));
} finally {
  await summaryClient.close();
  rmSync(summaryHome, { recursive: true, force: true });
}
