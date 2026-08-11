/**
 * Contract gate for the README — the surface a human sees first, and the one
 * nothing was comparing with reality.
 *
 * The demo/tool payloads got a contract gate; the documentation did not. A README
 * that names `aggregate.min` while the server emits `aggregate.numeric.min` fails
 * in SILENCE: the reader writes a parser, gets `undefined`, and blames their code.
 * 0.7.1 shipped exactly that — the tool bullets enumerated
 * `min/max/sum/average/count/date_range` as if they were top-level members of
 * `aggregate` (they live under `numeric`), omitted `count_by_type` and `units`
 * entirely, and the workout bullet omitted `distance_units` and `workout_count`.
 *
 * This gate does not copy the expected shape into itself — that would recreate the
 * drift one layer up. It PARSES README.md and compares what it finds there against
 * what the real server returns over stdio for the repo fixture.
 *
 * Three checks, each failing in both directions:
 *
 *   1. Every ```json block in the README is classified. A block must be preceded by
 *      `<!-- config-example -->` (client config, not a payload — out of contract) or
 *      `<!-- payload-example: <tool> <argsJson> -->` (tool output — verified below).
 *      An unmarked block fails, so a future ungated payload example cannot land.
 *   2. Each payload block's key paths must equal the real tool's key paths exactly:
 *        - key in the README the server never returns -> invented contract
 *        - key the server returns the README never shows -> incomplete contract
 *   3. The prose enumerations of the `aggregate` members (inside
 *      `record-aggregate-keys` / `workout-aggregate-keys` markers) and the same
 *      enumeration inside the live tool descriptions must equal the real aggregate's
 *      own top-level keys.
 *
 * Values are NOT compared: the README shows a realistic month, the fixture holds ten
 * synthetic records. Shape is the contract; the numbers are illustration.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const README = 'README.md';
const FIXTURE = 'fixtures/apple_health_export/export.xml';

/**
 * Objects whose KEYS are data, not contract: `count_by_type` is keyed by whichever
 * HealthKit types the export happens to hold. Descending into them would compare the
 * fixture's record types with the README's illustration and fail for no reason.
 */
const OPAQUE_MAPS = new Set(['aggregate.count_by_type', 'aggregate.count_by_activity']);

function keyPaths(value, prefix = '', out = new Set()) {
  if (Array.isArray(value)) {
    // Union across elements: one element alone under-describes an array's shape.
    for (const item of value) keyPaths(item, `${prefix}[]`, out);
    return out;
  }
  if (value === null || typeof value !== 'object') return out;
  for (const key of Object.keys(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    out.add(path);
    if (!OPAQUE_MAPS.has(path)) keyPaths(value[key], path, out);
  }
  return out;
}

function diff(documented, real) {
  return {
    invented: [...documented].filter((k) => !real.has(k)).sort(),
    missing: [...real].filter((k) => !documented.has(k)).sort()
  };
}

const text = readFileSync(README, 'utf8');

// ---------------------------------------------------------------------------
// 1. Classify every ```json block in the README.
// ---------------------------------------------------------------------------
const blocks = [];
const fence = /```json\n([\s\S]*?)```/g;
for (const match of text.matchAll(fence)) {
  const before = text.slice(0, match.index);
  // The classifying comment must be the last HTML comment before the fence, with
  // nothing but whitespace/blank lines between them.
  const tail = before.slice(-400);
  const marker = /<!--\s*(config-example|payload-example:\s*([a-z_]+)\s*(\{[\s\S]*?\}))\s*-->\s*$/.exec(tail);
  const line = before.split('\n').length;
  assert.ok(
    marker,
    `${README}:${line} — a \`\`\`json block with no classifying comment.\n` +
      '  Every JSON block must declare what it is, immediately above the fence:\n' +
      '    <!-- config-example -->                                (MCP client config; not tool output)\n' +
      '    <!-- payload-example: <tool_name> {"arg":"value"} -->   (tool output; verified against the real server)\n' +
      '  An unclassified block is an unverified promise, which is how README drift starts.'
  );
  let payload;
  try {
    payload = JSON.parse(match[1]);
  } catch (error) {
    assert.fail(`${README}:${line} — JSON block does not parse: ${error.message}`);
  }
  if (marker[1] === 'config-example') {
    blocks.push({ kind: 'config', line });
  } else {
    blocks.push({ kind: 'payload', line, tool: marker[2], args: JSON.parse(marker[3]), payload });
  }
}

const payloadBlocks = blocks.filter((block) => block.kind === 'payload');
assert.ok(payloadBlocks.length > 0, `${README} declares no payload examples — this gate would verify nothing.`);

// ---------------------------------------------------------------------------
// 2 + 3. Compare against the real server.
// ---------------------------------------------------------------------------
const client = new Client({ name: 'apple-health-mcp-readme-contract', version: '0.0.0' });
const transport = new StdioClientTransport({
  command: 'node',
  args: ['dist/index.js'],
  env: {
    ...process.env,
    APPLE_HEALTH_EXPORT_PATH: FIXTURE,
    APPLE_HEALTH_TIMEZONE: 'America/Fortaleza',
    APPLE_HEALTH_PRIVACY_MODE: 'summary'
  }
});
await client.connect(transport);

const failures = [];
let verified = 0;
const realByTool = new Map();

try {
  for (const block of payloadBlocks) {
    const result = await client.callTool({ name: block.tool, arguments: block.args });
    const real = result.structuredContent;
    assert.ok(
      real && !real.error,
      `${block.tool} returned no structured payload for the fixture: ${JSON.stringify(result.structuredContent)}`
    );
    realByTool.set(block.tool, real);

    const documentedKeys = keyPaths(block.payload);
    const realKeys = keyPaths(real);
    const { invented, missing } = diff(documentedKeys, realKeys);
    verified += documentedKeys.size;

    if (invented.length || missing.length) {
      const lines = [`\n  ${README}:${block.line} — ${block.tool} example drifted from the real server.`];
      if (invented.length) {
        lines.push(
          `  ${invented.length} key(s) the README shows that the server NEVER returns.`,
          '  A reader trusting these writes a parser for data that never arrives:',
          ...invented.map((k) => `    - ${k}`)
        );
      }
      if (missing.length) {
        lines.push(
          `  ${missing.length} key(s) the server returns that the README never shows.`,
          '  Readers will not know these exist:',
          ...missing.map((k) => `    + ${k}`)
        );
      }
      failures.push(lines.join('\n'));
    } else {
      console.log(`PASS ${block.tool} example — ${documentedKeys.size} key paths match the real server`);
    }
  }

  // The prose bullets under "Tools" enumerate the aggregate members. Same claim, same
  // drift risk, different sentence — so it gets the same comparison.
  const PROSE = [
    { marker: 'record-aggregate-keys', tool: 'apple_health_list_records' },
    { marker: 'workout-aggregate-keys', tool: 'apple_health_list_workouts' }
  ];
  for (const { marker, tool } of PROSE) {
    const pattern = new RegExp(`<!--\\s*${marker}:start\\s*-->([\\s\\S]*?)<!--\\s*${marker}:end\\s*-->`);
    const found = pattern.exec(text);
    assert.ok(
      found,
      `${README}: missing the "${marker}" markers. The prose list of \`aggregate\` members must stay ` +
        'inside them so this gate can compare it with the server — deleting the markers is not a way to pass.'
    );
    const documented = [...found[1].matchAll(/`([^`]+)`/g)].map((hit) => hit[1]).sort();
    const real = Object.keys(realByTool.get(tool)?.aggregate ?? {}).sort();
    assert.ok(real.length > 0, `${tool} returned no aggregate for the fixture; the prose check has nothing to compare.`);
    try {
      assert.deepEqual(
        documented,
        real,
        `${README} (${marker}): the prose names ${JSON.stringify(documented)} but ${tool} emits ` +
          `${JSON.stringify(real)}. Naming a nested field as if it were top-level is the 0.7.1 defect.`
      );
    } catch (error) {
      failures.push(`\n  ${error.message}`);
      continue;
    }
    verified += documented.length;
    console.log(`PASS ${marker} prose — ${documented.length} aggregate members match ${tool}`);
  }

  // The tool descriptions carried the identical wrong enumeration. An agent reads
  // those before it reads the README, so they get the same check.
  const tools = await client.listTools();
  for (const tool of ['apple_health_list_records', 'apple_health_list_workouts']) {
    const keys = Object.keys(realByTool.get(tool)?.aggregate ?? {}).sort();
    const description = tools.tools.find((entry) => entry.name === tool)?.description ?? '';
    const enumerated = /the `aggregate` block \(([^)]*)\)/.exec(description);
    assert.ok(enumerated, `${tool}: description must enumerate the aggregate members as "the \`aggregate\` block (...)".`);
    const documented = [...enumerated[1].matchAll(/`([^`]+)`/g)].map((hit) => hit[1]).sort();
    try {
      assert.deepEqual(
        documented,
        keys,
        `${tool} description names ${JSON.stringify(documented)} but the tool emits ${JSON.stringify(keys)}.`
      );
    } catch (error) {
      failures.push(`\n  ${error.message}`);
      continue;
    }
    verified += documented.length;
    console.log(`PASS ${tool} description — ${documented.length} aggregate members match the tool output`);
  }
} finally {
  await client.close();
}

if (failures.length) {
  console.error('\nFAIL the README no longer describes what the server returns:');
  console.error(failures.join('\n'));
  console.error(
    '\nFix README.md (and the tool description) to match the real payload.' +
      '\nDo not edit this gate to match the README — the README is the claim, the server is the fact.\n'
  );
  process.exit(1);
}

console.log(
  `\nreadme-contract: ${verified} documented key/member names verified against the real server ` +
    `(${payloadBlocks.length} payload example(s), ${blocks.length - payloadBlocks.length} config block(s) skipped as not-a-payload)`
);
console.log(JSON.stringify({ ok: true, suite: 'readme-contract', payload_examples: payloadBlocks.length }));
