/**
 * Regression gate for the scan memo behind `apple_health_list_records` /
 * `apple_health_list_workouts`.
 *
 * WHY THIS EXISTS
 *
 * 0.6.0 and 0.7.0 made summary-mode list calls correct by making them scan the export
 * to EOF: an aggregate that only covers the first page is a wrong answer, so `limit`
 * had to stop capping the scan. That bought correctness with latency, and the latency
 * is not small. Measured on synthetic exports with a warm page cache, one default
 * summary call costs roughly 33 ms per MB of export.xml — ~3.0 s at 84 MB, ~11.3 s at
 * 336 MB — against ~1 ms for the same call before, when it stopped at the cap. A
 * `type`/`start`/`end` filter does not shorten it: a match could still sit in the last
 * byte, so the stream runs to the end regardless.
 *
 * The first call has to pay that; the aggregate cannot be computed any other way. What
 * this gate protects is that an identical repeat inside the same session does NOT pay
 * it again, and — just as important — that the memo is bound to the export file, so a
 * fresh export is never answered from the old one.
 *
 * HOW THE MEMO IS PROVEN WITHOUT TIMING
 *
 * Wall-clock assertions are flaky in CI. Instead each scenario rewrites export.xml with
 * DIFFERENT VALUES at the SAME BYTE LENGTH and restores the original mtime. That is a
 * file the cache key (path + size + mtime) cannot distinguish from the original. So:
 *   - a memoized scan returns the OLD values (proving no re-read happened),
 *   - an un-memoized scan returns the NEW values.
 * Scenarios 1 and 4 therefore fail on 0.7.0, which had no scan memo and re-read the
 * file every time.
 *
 * All data here is synthetic. No real Apple Health export is ever read by this test.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the incremental cache from the real ~/.apple-health-mcp before anything reads it.
const fakeHome = mkdtempSync(join(tmpdir(), 'apple-health-scan-cache-home-'));
process.env.HOME = fakeHome;

const { scanRecords, scanWorkouts, clearSnapshotCache } = await import('../dist/services/apple-health-export.js');

const TYPE = 'HKQuantityTypeIdentifierHeartRate';
const RECORD_COUNT = 120;

/**
 * Build an export whose record values and workout energy are written at a FIXED WIDTH,
 * so swapping "010.00" for "099.00" leaves the file byte-for-byte the same size.
 */
function buildExport({ recordValue, workoutEnergy }) {
  assert.equal(recordValue.length, 6, 'record value must be fixed width');
  assert.equal(workoutEnergy.length, 6, 'workout energy must be fixed width');
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<HealthData locale="en_US">\n';
  for (let i = 0; i < RECORD_COUNT; i += 1) {
    const stamp = `2026-03-${String((i % 28) + 1).padStart(2, '0')} 08:00:00 -0300`;
    xml += `  <Record type="${TYPE}" sourceName="Synthetic Watch" unit="count/min" creationDate="${stamp}" startDate="${stamp}" endDate="${stamp}" value="${recordValue}"/>\n`;
  }
  for (let w = 0; w < 3; w += 1) {
    const stamp = `2026-03-${String(w + 1).padStart(2, '0')} 06:00:00 -0300`;
    const endStamp = `2026-03-${String(w + 1).padStart(2, '0')} 07:00:00 -0300`;
    xml += `  <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="60" durationUnit="min" totalDistance="5" totalDistanceUnit="km" totalEnergyBurned="${workoutEnergy}" totalEnergyBurnedUnit="kcal" sourceName="Synthetic Watch" creationDate="${stamp}" startDate="${stamp}" endDate="${endStamp}"/>\n`;
  }
  return `${xml}</HealthData>\n`;
}

const ORIGINAL = buildExport({ recordValue: '010.00', workoutEnergy: '100.00' });
const SWAPPED = buildExport({ recordValue: '099.00', workoutEnergy: '900.00' });
assert.equal(
  Buffer.byteLength(ORIGINAL),
  Buffer.byteLength(SWAPPED),
  'the two fixtures must be the same size, otherwise the cache key would see the difference'
);

const workdir = mkdtempSync(join(tmpdir(), 'apple-health-scan-cache-'));
const exportDir = join(workdir, 'apple_health_export');
mkdirSync(exportDir, { recursive: true });
const exportPath = join(exportDir, 'export.xml');

// The filesystem records mtime with sub-millisecond precision, but utimes() only writes
// whole milliseconds — so a natural mtime cannot be restored exactly after a rewrite.
// Pin the fixture to an explicit whole-millisecond mtime that does round-trip.
let currentMtime = new Date('2026-03-01T12:00:00.000Z');

function writeExport(content) {
  writeFileSync(exportPath, content);
  utimesSync(exportPath, currentMtime, currentMtime);
}

/** Replace the file contents while keeping size and mtime — invisible to the cache key. */
function swapContentPreservingIdentity(content) {
  const before = statSync(exportPath);
  writeFileSync(exportPath, content);
  utimesSync(exportPath, currentMtime, currentMtime);
  const after = statSync(exportPath);
  assert.equal(after.size, before.size, 'swap must preserve size');
  assert.equal(after.mtimeMs, before.mtimeMs, 'swap must preserve mtime');
}

/** Move the mtime forward, the way a freshly promoted export would. */
function touchExport() {
  const before = statSync(exportPath);
  currentMtime = new Date(currentMtime.getTime() + 5000);
  utimesSync(exportPath, currentMtime, currentMtime);
  assert.notEqual(statSync(exportPath).mtimeMs, before.mtimeMs);
}

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  ok   ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${label}\n       ${error.message}`);
  }
}

try {
  // ---------------------------------------------------------------------------
  // 1. An identical repeat record scan is served from the memo, not from the file.
  // ---------------------------------------------------------------------------
  writeExport(ORIGINAL);
  const first = await scanRecords({ exportPath, type: TYPE, limit: 10, aggregate: true, timezone: 'UTC' });
  check('scenario 1a: first scan aggregates every matching record', () => {
    assert.equal(first.matched_count, RECORD_COUNT);
    assert.equal(first.records.length, 10);
    assert.equal(first.truncated, true);
    assert.equal(first.aggregate?.numeric?.max, 10);
  });

  swapContentPreservingIdentity(SWAPPED);
  const second = await scanRecords({ exportPath, type: TYPE, limit: 10, aggregate: true, timezone: 'UTC' });
  check('scenario 1b: identical repeat is memoized (no second full read)', () => {
    assert.equal(
      second.aggregate?.numeric?.max,
      10,
      'got the swapped file\'s value, so the export was parsed a second time — the memo did not hold'
    );
    assert.equal(second.matched_count, RECORD_COUNT);
  });

  // A caller that mutates the list it received must not corrupt what the next one reads.
  second.records.length = 0;
  const third = await scanRecords({ exportPath, type: TYPE, limit: 10, aggregate: true, timezone: 'UTC' });
  check('scenario 1c: memo hands out a copy, not its own array', () => {
    assert.equal(third.records.length, 10, 'mutating a returned list corrupted the cached entry');
  });

  // ---------------------------------------------------------------------------
  // 2. A new export (mtime moved) invalidates the memo.
  // ---------------------------------------------------------------------------
  touchExport();
  const afterTouch = await scanRecords({ exportPath, type: TYPE, limit: 10, aggregate: true, timezone: 'UTC' });
  check('scenario 2: a changed mtime re-reads the export', () => {
    assert.equal(afterTouch.aggregate?.numeric?.max, 99, 'stale aggregate survived a new export');
  });

  // ---------------------------------------------------------------------------
  // 3. clearSnapshotCache() drops the scan memo too, not only the snapshot cache.
  //    The reimport/watch path calls it after promoting a new export; if the scan
  //    memo survived, list_* would keep answering from the previous file while the
  //    summaries had already moved on.
  // ---------------------------------------------------------------------------
  swapContentPreservingIdentity(ORIGINAL);
  clearSnapshotCache();
  const afterClear = await scanRecords({ exportPath, type: TYPE, limit: 10, aggregate: true, timezone: 'UTC' });
  check('scenario 3: clearSnapshotCache() also clears the scan memo', () => {
    assert.equal(afterClear.aggregate?.numeric?.max, 10, 'scan memo survived an explicit cache clear');
  });

  // ---------------------------------------------------------------------------
  // 4. Workout scans are memoized on the same terms.
  // ---------------------------------------------------------------------------
  const firstWorkouts = await scanWorkouts({ exportPath, limit: 10, aggregate: true, timezone: 'UTC' });
  check('scenario 4a: first workout scan totals every matching workout', () => {
    assert.equal(firstWorkouts.matched_count, 3);
    assert.equal(firstWorkouts.aggregate?.total_energy_kcal, 300);
  });

  swapContentPreservingIdentity(SWAPPED);
  const secondWorkouts = await scanWorkouts({ exportPath, limit: 10, aggregate: true, timezone: 'UTC' });
  check('scenario 4b: identical repeat workout scan is memoized', () => {
    assert.equal(
      secondWorkouts.aggregate?.total_energy_kcal,
      300,
      'got the swapped file\'s totals, so the export was parsed a second time'
    );
  });

  // ---------------------------------------------------------------------------
  // 5. A different query is a different key — the memo must not answer it.
  // ---------------------------------------------------------------------------
  touchExport();
  const narrow = await scanRecords({
    exportPath,
    type: TYPE,
    start: '2026-03-01',
    end: '2026-03-02',
    limit: 10,
    aggregate: true,
    timezone: 'UTC'
  });
  const wide = await scanRecords({ exportPath, type: TYPE, limit: 10, aggregate: true, timezone: 'UTC' });
  check('scenario 5: a narrower date window is not served from the wider entry', () => {
    assert.ok(
      narrow.matched_count < RECORD_COUNT,
      `narrow window matched ${narrow.matched_count}, same as the unfiltered scan — keys collided`
    );
    assert.equal(wide.matched_count, RECORD_COUNT);
  });

  // ---------------------------------------------------------------------------
  // 6. The incremental path is never memoized. It advances a persistent cursor as a
  //    side effect, so its answer depends on state the key cannot see: serving call 2
  //    from a memo would replay a page the caller already consumed.
  // ---------------------------------------------------------------------------
  const incrementalOne = await scanRecords({
    exportPath,
    type: TYPE,
    limit: 500,
    aggregate: true,
    timezone: 'UTC',
    useIncrementalCache: true
  });
  const incrementalTwo = await scanRecords({
    exportPath,
    type: TYPE,
    limit: 500,
    aggregate: true,
    timezone: 'UTC',
    useIncrementalCache: true
  });
  check('scenario 6: incremental_cache scans bypass the memo', () => {
    assert.equal(incrementalOne.records.length, RECORD_COUNT, 'first incremental page should return every record');
    assert.equal(
      incrementalTwo.records.length,
      0,
      'second incremental call replayed the first page — it was answered from the memo instead of the advanced cursor'
    );
  });

  if (failures > 0) {
    console.error(`\nscan-cache-test: ${failures} scenario(s) failed`);
    process.exit(1);
  }
  console.log('\nscan-cache-test: all scenarios passed');
} finally {
  rmSync(workdir, { recursive: true, force: true });
  rmSync(fakeHome, { recursive: true, force: true });
}
