/**
 * Regression gate for two statistics defects:
 *
 * 1. apple_health_list_records returned `aggregate` computed over the records that
 *    survived `limit`, presented as if it described the whole filtered set. An agent
 *    asking for the minimum heart rate got the minimum of the first page.
 *    Fixture: 800 synthetic records with the true min planted at index 750 and the
 *    true max at index 780 — both far past the default limit of 50.
 *
 * 2. summary.ts computed per-day min/max with Math.min(...values), which throws
 *    RangeError once a day carries more than ~120k numeric records.
 *    Fixture: a single synthetic day with 130k heart-rate records.
 *
 * All data here is synthetic. No real Apple Health export is ever read by this test.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const XML_HEADER = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE HealthData [
  <!ELEMENT HealthData (Record|Workout)*>
  <!ELEMENT Record (MetadataEntry)*>
  <!ELEMENT Workout (WorkoutEvent|MetadataEntry)*>
  <!ELEMENT MetadataEntry EMPTY>
  <!ELEMENT WorkoutEvent EMPTY>
]>
<HealthData locale="en_US">
`;

const OFFSET = '-0300';
const TIMEZONE = 'America/Fortaleza';

function appleStamp(baseIsoDate, minutesFromMidnight) {
  const hour = Math.floor(minutesFromMidnight / 60);
  const minute = minutesFromMidnight % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${baseIsoDate} ${pad(hour)}:${pad(minute)}:00 ${OFFSET}`;
}

function isoFor(baseIsoDate, minutesFromMidnight) {
  const hour = Math.floor(minutesFromMidnight / 60);
  const minute = minutesFromMidnight % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return new Date(`${baseIsoDate}T${pad(hour)}:${pad(minute)}:00${OFFSET.slice(0, 3)}:${OFFSET.slice(3)}`).toISOString();
}

function recordXml({ type, unit, value, stamp }) {
  return `  <Record type="${type}" sourceName="Synthetic Watch" unit="${unit}" creationDate="${stamp}" startDate="${stamp}" endDate="${stamp}" value="${value}"/>\n`;
}

/**
 * 800 heart-rate records, chronological, where the real min and max only appear
 * well past the default page of 50, plus a 10-record type that never truncates.
 */
function buildTruncationExport() {
  const date = '2026-05-01';
  const total = 800;
  const plantedMinIndex = 750;
  const plantedMaxIndex = 780;
  const values = [];
  let xml = XML_HEADER;

  for (let index = 0; index < total; index += 1) {
    let value = 120 + (index % 40); // every ordinary value is >= 120
    if (index === plantedMinIndex) value = 85;
    if (index === plantedMaxIndex) value = 175;
    values.push(value);
    xml += recordXml({
      type: 'HKQuantityTypeIdentifierHeartRate',
      unit: 'count/min',
      value,
      stamp: appleStamp(date, index)
    });
  }

  const smallTotal = 10;
  for (let index = 0; index < smallTotal; index += 1) {
    xml += recordXml({
      type: 'HKQuantityTypeIdentifierRespiratoryRate',
      unit: 'count/min',
      value: 12 + index,
      stamp: appleStamp(date, index)
    });
  }
  xml += '</HealthData>\n';

  const sum = values.reduce((acc, value) => acc + value, 0);
  return {
    xml,
    truth: {
      total,
      small_total: smallTotal,
      min: 85,
      max: 175,
      sum,
      average: Math.round((sum / total) * 100) / 100,
      first_iso: isoFor(date, 0),
      last_iso: isoFor(date, total - 1),
      date
    }
  };
}

/** One synthetic day large enough to overflow Math.min(...values). */
function buildLargeDayExport() {
  const date = '2026-06-01';
  const total = 130_000;
  const plantedMinIndex = 90_000;
  const plantedMaxIndex = 120_000;
  const parts = [XML_HEADER];
  for (let index = 0; index < total; index += 1) {
    let value = 60 + (index % 60);
    if (index === plantedMinIndex) value = 33;
    if (index === plantedMaxIndex) value = 199;
    // Keep every record inside the same local day (0..1439 minutes).
    parts.push(recordXml({
      type: 'HKQuantityTypeIdentifierHeartRate',
      unit: 'count/min',
      value,
      stamp: appleStamp(date, index % 1440)
    }));
  }
  parts.push('</HealthData>\n');
  return { xml: parts.join(''), truth: { total, min: 33, max: 199, date } };
}

const workdir = mkdtempSync(join(tmpdir(), 'apple-health-aggregate-'));
const truncation = buildTruncationExport();
const largeDay = buildLargeDayExport();
// The connector only accepts a file literally named export.xml (or a directory/zip
// holding one), so each synthetic export gets its own folder.
const truncationPath = join(workdir, 'truncation', 'export.xml');
const largeDayPath = join(workdir, 'large-day', 'export.xml');
mkdirSync(join(workdir, 'truncation'), { recursive: true });
mkdirSync(join(workdir, 'large-day'), { recursive: true });
writeFileSync(truncationPath, truncation.xml);
writeFileSync(largeDayPath, largeDay.xml);

function callList(client, args) {
  return client.callTool({ name: 'apple_health_list_records', arguments: args });
}

async function withServer(exportPath, fn) {
  const client = new Client({ name: 'apple-health-aggregate-test', version: '0.0.0' });
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    env: { ...process.env, APPLE_HEALTH_EXPORT_PATH: exportPath, APPLE_HEALTH_TIMEZONE: TIMEZONE }
  });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

try {
  await withServer(truncationPath, async (client) => {
    // Default call: no limit, no privacy_mode, no flags — exactly how an agent asks.
    const summary = await callList(client, {
      type: 'HKQuantityTypeIdentifierHeartRate',
      response_format: 'json'
    });
    const payload = summary.structuredContent;

    assert.equal(payload?.privacy_mode, 'summary', 'default privacy mode should stay summary');
    assert.equal(
      payload?.aggregate?.numeric?.min,
      truncation.truth.min,
      `aggregate.numeric.min must be the true minimum (${truncation.truth.min}), not the minimum of the first page`
    );
    assert.equal(payload?.aggregate?.numeric?.max, truncation.truth.max, 'aggregate.numeric.max must be the true maximum');
    assert.equal(payload?.aggregate?.numeric?.count, truncation.truth.total, 'aggregate.numeric.count must cover every matching record');
    assert.equal(payload?.aggregate?.numeric?.sum, truncation.truth.sum, 'aggregate.numeric.sum must cover every matching record');
    assert.equal(payload?.aggregate?.numeric?.average, truncation.truth.average, 'aggregate.numeric.average must cover every matching record');
    assert.equal(
      payload?.aggregate?.count_by_type?.HKQuantityTypeIdentifierHeartRate,
      truncation.truth.total,
      'aggregate.count_by_type must cover every matching record'
    );
    assert.equal(payload?.aggregate?.date_range?.first, truncation.truth.first_iso, 'aggregate.date_range.first must be the true earliest timestamp');
    assert.equal(payload?.aggregate?.date_range?.last, truncation.truth.last_iso, 'aggregate.date_range.last must be the true latest timestamp');

    // Truncation must be announced, not inferred.
    assert.equal(payload?.truncated, true, 'truncated must be true when the listing was capped by limit');
    assert.equal(payload?.limit_applied, 50, 'limit_applied must report the effective limit');
    assert.equal(payload?.matched_count, truncation.truth.total, 'matched_count must report every record matching the filter');
    assert.equal(payload?.aggregate_scope, 'all_matching_records', 'aggregate_scope must state that the aggregate covers the full filtered set');

    // Markdown is the default response_format — the truncation warning must survive there too.
    const markdown = await callList(client, { type: 'HKQuantityTypeIdentifierHeartRate' });
    const text = markdown.content?.map((item) => item.text ?? '').join('\n') ?? '';
    assert.match(text, /truncated/i, 'markdown output must disclose truncation');
    assert.match(text, /aggregate_min\*\*: 85/, 'markdown output must carry the true minimum, not the first page minimum');
    assert.match(text, /aggregate_max\*\*: 175/, 'markdown output must carry the true maximum');

    // Raw mode still pages the list, and still reports the truth about the cap.
    const raw = await callList(client, {
      type: 'HKQuantityTypeIdentifierHeartRate',
      privacy_mode: 'raw',
      response_format: 'json'
    });
    assert.equal(raw.structuredContent?.records?.length, 50, 'raw mode must still respect limit');
    assert.equal(raw.structuredContent?.count, 50, 'count must describe the returned listing');
    assert.equal(raw.structuredContent?.truncated, true, 'raw mode must disclose truncation');

    // Explicit limit above the match count: nothing is truncated.
    const small = await callList(client, {
      type: 'HKQuantityTypeIdentifierRespiratoryRate',
      limit: 100,
      response_format: 'json'
    });
    assert.equal(small.structuredContent?.truncated, false, 'truncated must be false when every match fits in the page');
    assert.equal(small.structuredContent?.matched_count, truncation.truth.small_total, 'matched_count must be exact when nothing is truncated');
    assert.equal(
      small.structuredContent?.aggregate?.numeric?.count,
      truncation.truth.small_total,
      'aggregate must still describe the full set when nothing is truncated'
    );
  });

  await withServer(largeDayPath, async (client) => {
    const daily = await client.callTool({
      name: 'apple_health_daily_summary',
      arguments: { date: largeDay.truth.date, timezone: TIMEZONE, response_format: 'json' }
    });
    assert.equal(daily.isError ?? false, false, `daily summary must not error on a ${largeDay.truth.total}-record day: ${JSON.stringify(daily.content)}`);
    assert.equal(daily.structuredContent?.heart?.min_bpm, largeDay.truth.min, 'min_bpm must survive a 130k-value day (Math.min spread overflows)');
    assert.equal(daily.structuredContent?.heart?.max_bpm, largeDay.truth.max, 'max_bpm must survive a 130k-value day');
    assert.equal(daily.structuredContent?.data_quality?.record_count, largeDay.truth.total, 'every synthetic record must be counted');
  });

  console.log(JSON.stringify({
    ok: true,
    aggregate_truncation: true,
    records_scanned: truncation.truth.total,
    true_min: truncation.truth.min,
    large_day_records: largeDay.truth.total
  }, null, 2));
} finally {
  rmSync(workdir, { recursive: true, force: true });
}
