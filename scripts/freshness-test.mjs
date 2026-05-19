import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildExportFreshness, formatExportFreshnessMarkdown } from '../dist/services/freshness.js';

const MS_DAY = 86_400_000;

// ---------- no export configured ----------

{
  const out = await buildExportFreshness(undefined);
  assert.equal(out.ok, false);
  assert.equal(out.exists, false);
  assert.equal(out.is_stale, true);
  assert.equal(out.stale_reason, 'no_export');
  assert.match(out.recommendation, /APPLE_HEALTH_EXPORT_PATH|export/i);
}

// ---------- non-existent path ----------

{
  const out = await buildExportFreshness('/tmp/__definitely_not_here.xml');
  assert.equal(out.exists, false);
  assert.equal(out.is_stale, true);
  assert.equal(out.stale_reason, 'no_export');
}

// ---------- fresh fixture export ----------

const fixturePath = resolve('fixtures/apple_health_export/export.xml');
const fixtureStat = await fs.stat(fixturePath);

// Force "now" to be just after fixture mtime so it always reports 0 days.
const fixtureFreshNow = fixtureStat.mtimeMs + 60_000;

{
  const out = await buildExportFreshness(fixturePath, { now: () => fixtureFreshNow });
  assert.equal(out.exists, true);
  assert.equal(out.export_kind, 'xml');
  assert.equal(out.days_since_export, 0);
  assert.equal(out.is_stale, false);
  assert.equal(out.stale_reason, null);
  assert.equal(out.recommendation, 'Export is fresh');
}

// ---------- 31 days old → stale (older_than_30d) ----------

{
  const out = await buildExportFreshness(fixturePath, {
    now: () => fixtureStat.mtimeMs + 31 * MS_DAY
  });
  assert.equal(out.exists, true);
  assert.equal(out.days_since_export, 31);
  assert.equal(out.is_stale, true);
  assert.equal(out.stale_reason, 'older_than_30d');
  assert.match(out.recommendation, />30 days|re-export/i);
}

// ---------- 8 days old + no recent records → stale (older_than_7d_and_no_recent_records) ----------

{
  const out = await buildExportFreshness(fixturePath, {
    now: () => fixtureStat.mtimeMs + 8 * MS_DAY,
    daysSinceLatestRecord: 9
  });
  assert.equal(out.days_since_export, 8);
  assert.equal(out.recent_records_found, false);
  assert.equal(out.is_stale, true);
  assert.equal(out.stale_reason, 'older_than_7d_and_no_recent_records');
}

// ---------- 8 days old WITH recent records (≤7 days) → still fresh ----------

{
  const out = await buildExportFreshness(fixturePath, {
    now: () => fixtureStat.mtimeMs + 8 * MS_DAY,
    daysSinceLatestRecord: 3
  });
  assert.equal(out.days_since_export, 8);
  assert.equal(out.recent_records_found, true);
  assert.equal(out.is_stale, false);
  assert.equal(out.recommendation, 'Export is fresh');
}

// ---------- 8 days old + no inventory data → not stale (uncertain → fresh) ----------

{
  const out = await buildExportFreshness(fixturePath, {
    now: () => fixtureStat.mtimeMs + 8 * MS_DAY
  });
  assert.equal(out.days_since_export, 8);
  assert.equal(out.recent_records_found, undefined);
  // Cannot confirm "no recent records" without inventory → not stale.
  assert.equal(out.is_stale, false);
}

// ---------- 6 days old → fresh regardless of inventory ----------

{
  const out = await buildExportFreshness(fixturePath, {
    now: () => fixtureStat.mtimeMs + 6 * MS_DAY,
    daysSinceLatestRecord: 6
  });
  assert.equal(out.is_stale, false);
  assert.equal(out.recommendation, 'Export is fresh');
}

// ---------- temp file with controllable mtime for boundary check ----------

const tmp = mkdtempSync(join(tmpdir(), 'apple-health-freshness-'));
try {
  const xmlPath = join(tmp, 'export.xml');
  await fs.writeFile(xmlPath, '<HealthData></HealthData>', 'utf8');
  const newStat = await fs.stat(xmlPath);

  // Exactly 30 days → not stale (boundary)
  let out = await buildExportFreshness(xmlPath, {
    now: () => newStat.mtimeMs + 30 * MS_DAY
  });
  assert.equal(out.days_since_export, 30);
  assert.equal(out.is_stale, false);

  // 30 days + 1 second → 30 days (Math.floor), boundary still not stale
  out = await buildExportFreshness(xmlPath, {
    now: () => newStat.mtimeMs + 30 * MS_DAY + 1000
  });
  assert.equal(out.is_stale, false);

  // Just over 31 days → stale
  out = await buildExportFreshness(xmlPath, {
    now: () => newStat.mtimeMs + 31 * MS_DAY + 1000
  });
  assert.equal(out.is_stale, true);
  assert.equal(out.stale_reason, 'older_than_30d');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ---------- markdown formatter ----------

{
  const out = await buildExportFreshness(fixturePath, { now: () => fixtureFreshNow });
  const md = formatExportFreshnessMarkdown(out);
  assert.match(md, /Apple Health Export Freshness/);
  assert.match(md, /is_stale.*false/);
  assert.match(md, /Export is fresh/);
}

console.log(JSON.stringify({ ok: true, freshness: true }, null, 2));
