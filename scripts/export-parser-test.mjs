import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const exportPath = resolve('fixtures/apple_health_export/export.xml');
const client = new Client({ name: 'apple-health-export-test', version: '0.0.0' });
const transport = new StdioClientTransport({
  command: 'node',
  args: ['dist/index.js'],
  env: { ...process.env, APPLE_HEALTH_EXPORT_PATH: exportPath }
});

await client.connect(transport);
try {
  const status = await client.callTool({ name: 'apple_health_connection_status', arguments: { response_format: 'json' } });
  assert.equal(status.structuredContent?.ok, true);
  assert.equal(status.structuredContent?.export?.kind, 'xml');
  assert.equal(status.structuredContent?.export?.exists, true);

  const records = await client.callTool({
    name: 'apple_health_list_records',
    arguments: { type: 'HKQuantityTypeIdentifierStepCount', limit: 10, response_format: 'json' }
  });
  assert.equal(records.structuredContent?.count, 3);
  assert.equal(records.structuredContent?.records?.[0]?.sourceName, 'iPhone');

  const workouts = await client.callTool({ name: 'apple_health_list_workouts', arguments: { limit: 10, response_format: 'json' } });
  assert.equal(workouts.structuredContent?.count, 1);
  assert.equal(workouts.structuredContent?.workouts?.[0]?.workoutActivityType, 'HKWorkoutActivityTypeRunning');

  const daily = await client.callTool({
    name: 'apple_health_daily_summary',
    arguments: { date: '2026-05-01', response_format: 'json' }
  });
  assert.equal(daily.structuredContent?.date, '2026-05-01');
  assert.equal(daily.structuredContent?.totals?.steps, 4000);
  assert.equal(daily.structuredContent?.heart?.resting_bpm, 58);
  assert.equal(daily.structuredContent?.heart?.hrv_sdnn_ms, 72);
  assert.equal(daily.structuredContent?.sleep?.minutes_asleep, 420);
  assert.equal(daily.structuredContent?.workouts?.count, 1);

  const weekly = await client.callTool({
    name: 'apple_health_weekly_summary',
    arguments: { end_date: '2026-05-02', days: 2, response_format: 'json' }
  });
  assert.equal(weekly.structuredContent?.days, 2);
  assert.equal(weekly.structuredContent?.totals?.steps, 5000);

  console.log(JSON.stringify({ ok: true, export_parser: true, daily_steps: daily.structuredContent?.totals?.steps }, null, 2));
} finally {
  await client.close();
}
