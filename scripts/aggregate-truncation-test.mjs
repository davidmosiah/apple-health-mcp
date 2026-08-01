/**
 * Regression gate for three statistics defects:
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
 * 3. apple_health_list_workouts had defect 1 in its worse form: the workout aggregate
 *    is made of SUMS (energy, duration, distance), so aggregating only the first page
 *    answers "how much did I run this month" with a number that is simply too small.
 *    Fixture: 128 synthetic workouts against the default limit of 50, with the totals
 *    known exactly.
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

function dayFrom(baseIsoDate, dayOffset) {
  const base = new Date(`${baseIsoDate}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + dayOffset);
  return base.toISOString().slice(0, 10);
}

function dayStamp(baseIsoDate, dayOffset, hour) {
  return `${dayFrom(baseIsoDate, dayOffset)} ${String(hour).padStart(2, '0')}:00:00 ${OFFSET}`;
}

function dayIso(baseIsoDate, dayOffset, hour) {
  const day = dayFrom(baseIsoDate, dayOffset);
  return new Date(`${day}T${String(hour).padStart(2, '0')}:00:00${OFFSET.slice(0, 3)}:${OFFSET.slice(3)}`).toISOString();
}

function workoutXml({ activity, startStamp, endStamp, durationMinutes, distanceKm, energyKcal }) {
  const distanceAttrs = distanceKm === undefined ? '' : ` totalDistance="${distanceKm}" totalDistanceUnit="km"`;
  return `  <Workout workoutActivityType="${activity}" sourceName="Synthetic Watch" duration="${durationMinutes}" durationUnit="min"${distanceAttrs} totalEnergyBurned="${energyKcal}" totalEnergyBurnedUnit="kcal" creationDate="${startStamp}" startDate="${startStamp}" endDate="${endStamp}"/>\n`;
}

/**
 * 128 workouts — far past the default page of 50 — with exactly known totals:
 * 120 runs of 60 min / 5 km / 500 kcal, then 8 yoga sessions of 30 min / 100 kcal.
 * A first page of 50 sums to 25.000 kcal; the truth is 60.800 kcal.
 */
function buildWorkoutExport() {
  const base = '2026-01-01';
  const runs = 120;
  const yoga = 8;
  const yogaStartDay = 200;
  let xml = XML_HEADER;

  for (let index = 0; index < runs; index += 1) {
    xml += workoutXml({
      activity: 'HKWorkoutActivityTypeRunning',
      startStamp: dayStamp(base, index, 6),
      endStamp: dayStamp(base, index, 7),
      durationMinutes: 60,
      distanceKm: 5,
      energyKcal: 500
    });
  }
  for (let index = 0; index < yoga; index += 1) {
    xml += workoutXml({
      activity: 'HKWorkoutActivityTypeYoga',
      startStamp: dayStamp(base, yogaStartDay + index, 18),
      endStamp: dayStamp(base, yogaStartDay + index, 19),
      durationMinutes: 30,
      energyKcal: 100
    });
  }
  xml += '</HealthData>\n';

  // A 10-day window over the first runs only: matches fewer workouts than the limit,
  // so nothing is truncated and the totals must still be exact.
  const windowDays = 10;
  return {
    xml,
    truth: {
      total: runs + yoga,
      runs,
      yoga,
      total_energy_kcal: runs * 500 + yoga * 100,
      total_duration_minutes: runs * 60 + yoga * 30,
      total_distance: runs * 5,
      first_iso: dayIso(base, 0, 6),
      last_iso: dayIso(base, yogaStartDay + yoga - 1, 19),
      // What the defect reported instead: the first page's sums, presented as the period's.
      first_page_energy_kcal: 50 * 500,
      window: {
        start: `${dayFrom(base, 0)}T00:00:00${OFFSET.slice(0, 3)}:${OFFSET.slice(3)}`,
        end: `${dayFrom(base, windowDays - 1)}T23:59:59${OFFSET.slice(0, 3)}:${OFFSET.slice(3)}`,
        count: windowDays,
        total_energy_kcal: windowDays * 500,
        total_distance: windowDays * 5
      }
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
const workoutSet = buildWorkoutExport();
// The connector only accepts a file literally named export.xml (or a directory/zip
// holding one), so each synthetic export gets its own folder.
const truncationPath = join(workdir, 'truncation', 'export.xml');
const largeDayPath = join(workdir, 'large-day', 'export.xml');
const workoutPath = join(workdir, 'workouts', 'export.xml');
mkdirSync(join(workdir, 'truncation'), { recursive: true });
mkdirSync(join(workdir, 'large-day'), { recursive: true });
mkdirSync(join(workdir, 'workouts'), { recursive: true });
writeFileSync(truncationPath, truncation.xml);
writeFileSync(largeDayPath, largeDay.xml);
writeFileSync(workoutPath, workoutSet.xml);

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

  await withServer(workoutPath, async (client) => {
    const callWorkouts = (args) => client.callTool({ name: 'apple_health_list_workouts', arguments: args });

    // Default call: no limit, no privacy_mode — exactly how an agent asks
    // "how much did I train this period?".
    const summary = await callWorkouts({ response_format: 'json' });
    const payload = summary.structuredContent;
    const aggregate = payload?.aggregate;

    assert.equal(payload?.privacy_mode, 'summary', 'default privacy mode should stay summary');
    assert.notEqual(
      aggregate?.total_energy_kcal,
      workoutSet.truth.first_page_energy_kcal,
      'total_energy_kcal must not be the first page total presented as the period total'
    );
    assert.equal(
      aggregate?.total_energy_kcal,
      workoutSet.truth.total_energy_kcal,
      `total_energy_kcal must sum every matching workout (${workoutSet.truth.total_energy_kcal})`
    );
    assert.equal(
      aggregate?.total_duration_minutes,
      workoutSet.truth.total_duration_minutes,
      'total_duration_minutes must sum every matching workout'
    );
    assert.equal(aggregate?.total_distance, workoutSet.truth.total_distance, 'total_distance must sum every matching workout');
    assert.equal(
      aggregate?.count_by_activity?.HKWorkoutActivityTypeRunning,
      workoutSet.truth.runs,
      'count_by_activity must count every matching workout, not the page'
    );
    assert.equal(aggregate?.count_by_activity?.HKWorkoutActivityTypeYoga, workoutSet.truth.yoga, 'activities outside the page must still be counted');
    assert.equal(aggregate?.workout_count, workoutSet.truth.total, 'workout_count must state how many workouts the aggregate covers');
    assert.equal(aggregate?.date_range?.first, workoutSet.truth.first_iso, 'date_range.first must be the true earliest workout timestamp');
    assert.equal(aggregate?.date_range?.last, workoutSet.truth.last_iso, 'date_range.last must be the true latest workout timestamp, not the last one on the page');
    assert.deepEqual(aggregate?.distance_units, ['km'], 'distance_units must reflect the whole match set');

    // Truncation must be announced, not inferred.
    assert.equal(payload?.truncated, true, 'truncated must be true when the workout listing was capped by limit');
    assert.equal(payload?.limit_applied, 50, 'limit_applied must report the effective limit');
    assert.equal(payload?.matched_count, workoutSet.truth.total, 'matched_count must report every workout matching the filter');
    assert.equal(payload?.aggregate_scope, 'all_matching_workouts', 'aggregate_scope must state that the aggregate covers the full filtered set');

    // Markdown is the default response_format — the corrected totals must survive there.
    const markdown = await callWorkouts({});
    const text = markdown.content?.map((item) => item.text ?? '').join('\n') ?? '';
    assert.match(text, /truncated/i, 'markdown output must disclose truncation');
    assert.match(
      text,
      new RegExp(`aggregate_total_energy_kcal\\*\\*: ${workoutSet.truth.total_energy_kcal}`),
      'markdown output must carry the true energy total, not the first page total'
    );
    assert.match(
      text,
      new RegExp(`aggregate_total_distance\\*\\*: ${workoutSet.truth.total_distance}`),
      'markdown output must carry the true distance total'
    );

    // Raw mode still pages the list, and still reports the truth about the cap.
    const raw = await callWorkouts({ privacy_mode: 'raw', response_format: 'json' });
    assert.equal(raw.structuredContent?.workouts?.length, 50, 'raw mode must still respect limit');
    assert.equal(raw.structuredContent?.count, 50, 'count must describe the returned listing');
    assert.equal(raw.structuredContent?.truncated, true, 'raw mode must disclose truncation');

    // Structured mode pages the list too, and discloses the cap the same way.
    const structured = await callWorkouts({ privacy_mode: 'structured', limit: 20, response_format: 'json' });
    assert.equal(structured.structuredContent?.workouts?.length, 20, 'structured mode must respect an explicit limit');
    assert.equal(structured.structuredContent?.truncated, true, 'structured mode must disclose truncation');
    assert.equal(structured.structuredContent?.limit_applied, 20, 'limit_applied must echo the explicit limit');

    // Explicit limit above the match count: nothing is truncated, totals unchanged.
    const whole = await callWorkouts({ limit: 200, response_format: 'json' });
    assert.equal(whole.structuredContent?.truncated, false, 'truncated must be false when every match fits in the page');
    assert.equal(whole.structuredContent?.matched_count, workoutSet.truth.total, 'matched_count must be exact when nothing is truncated');
    assert.equal(
      whole.structuredContent?.aggregate?.total_energy_kcal,
      workoutSet.truth.total_energy_kcal,
      'totals must be identical whether or not the page held every workout'
    );

    // A date window narrower than the limit: the aggregate must follow the filter,
    // proving the fix did not simply start summing the whole export.
    const windowed = await callWorkouts({
      start: workoutSet.truth.window.start,
      end: workoutSet.truth.window.end,
      response_format: 'json'
    });
    assert.equal(windowed.structuredContent?.truncated, false, 'a 10-workout window must not be truncated under a limit of 50');
    assert.equal(windowed.structuredContent?.matched_count, workoutSet.truth.window.count, 'matched_count must respect the date filter');
    assert.equal(
      windowed.structuredContent?.aggregate?.total_energy_kcal,
      workoutSet.truth.window.total_energy_kcal,
      'aggregate must cover the filtered window only, not the whole export'
    );
    assert.equal(
      windowed.structuredContent?.aggregate?.total_distance,
      workoutSet.truth.window.total_distance,
      'aggregate distance must respect the date filter'
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
    workouts_scanned: workoutSet.truth.total,
    true_total_energy_kcal: workoutSet.truth.total_energy_kcal,
    large_day_records: largeDay.truth.total
  }, null, 2));
} finally {
  rmSync(workdir, { recursive: true, force: true });
}
