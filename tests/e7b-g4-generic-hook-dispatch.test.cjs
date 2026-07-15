'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('plan pre dispatches third-party steps unconditionally and preserves special cases', () => {
  const workflow = read('gsd-core/workflows/plan-phase.md');
  assert.match(workflow, /dispatch third-party hooks unconditionally/);
  assert.match(workflow, /ref\.skill/);
  assert.match(workflow, /ref\.agent/);
  assert.match(workflow, /research.*UI auto-chain.*pattern-mapper/s);
  assert.match(workflow, /Contributions targeting the planner are injected/);
});

test('ship pre dispatches generic steps and contributions before its security gate', () => {
  const workflow = read('gsd-core/workflows/ship.md');
  const generic = workflow.indexOf('Generic `ship:pre` capability dispatch');
  const security = workflow.indexOf('Security ship gate');
  assert.ok(generic >= 0);
  assert.ok(security >= 0);
  assert.ok(generic < security);
  assert.match(workflow, /kind == "step"/);
  assert.match(workflow, /kind == "contribution"/);
});

test('shared dispatch reference defines the required ordering', () => {
  const reference = read('gsd-core/references/loop-hook-dispatch.md');
  for (const phrase of [
    'delete artifacts',
    'dispatch active',
    'inject active',
    'eval-gates',
    'block: true',
  ]) assert.match(reference, new RegExp(phrase.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
});
