import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const expectedTools = [
  'apple_health_agent_manifest',
  'apple_health_capabilities',
  'apple_health_connection_status',
  'apple_health_daily_summary',
  'apple_health_list_records',
  'apple_health_list_workouts',
  'apple_health_privacy_audit',
  'apple_health_weekly_summary',
  'apple_health_wellness_context'
];

const expectedResources = [
  'apple-health://agent-manifest',
  'apple-health://capabilities',
  'apple-health://summary/daily',
  'apple-health://summary/weekly'
];

const expectedPrompts = [
  'apple_health_daily_review',
  'apple_health_weekly_review'
];

const client = new Client({ name: 'apple-health-mcp-smoke-test', version: '0.0.0' });
const transport = new StdioClientTransport({ command: 'node', args: ['dist/index.js'] });
await client.connect(transport);
try {
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), expectedTools.sort());

  const resources = await client.listResources();
  assert.deepEqual(resources.resources.map((resource) => resource.uri).sort(), expectedResources.sort());

  const prompts = await client.listPrompts();
  assert.deepEqual(prompts.prompts.map((prompt) => prompt.name).sort(), expectedPrompts.sort());

  const manifest = await client.callTool({ name: 'apple_health_agent_manifest', arguments: { client: 'hermes', response_format: 'json' } });
  assert.equal(manifest.structuredContent?.client, 'hermes');
  assert.equal(manifest.structuredContent?.healthkit_live_access, false);
  assert.ok(manifest.structuredContent?.agent_rules?.some((rule) => /export/i.test(rule)));

  const status = await client.callTool({ name: 'apple_health_connection_status', arguments: { client: 'hermes', response_format: 'json' } });
  assert.equal(status.structuredContent?.ok, false);
  assert.equal(status.structuredContent?.client, 'hermes');
  assert.ok(status.structuredContent?.next_steps?.some((step) => step.includes('APPLE_HEALTH_EXPORT_PATH')));

  console.log(JSON.stringify({ ok: true, tools: expectedTools.length, resources: expectedResources.length, prompts: expectedPrompts.length }, null, 2));
} finally {
  await client.close();
}
