'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const evalGates = require('../gsd-core/bin/lib/eval-gates.cjs');

test('point ordering deletes stale step products before artifact gates run', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-e7b-g6-'));
  const artifact = path.join(cwd, 'clearance.md');
  fs.writeFileSync(artifact, 'stale');
  const hooks = [
    { capId: 'producer', kind: 'step', produces: ['clearance.md'] },
    { capId: 'gate-cap', kind: 'gate', blocking: true, check: { predicate: { kind: 'artifact-exists', path: 'clearance.md' } } },
  ];
  evalGates.clearProducedArtifacts(hooks, cwd);
  const result = evalGates.evaluateGates([hooks[1]], { cwd });
  assert.equal(fs.existsSync(artifact), false);
  assert.equal(result.gates[0].block, true);
});

test('point ordering is documented at plan, execute, ship, and shared reference points', () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const execute = read('gsd-core/workflows/execute-phase.md');
  const plan = read('gsd-core/workflows/plan-phase.md');
  const ship = read('gsd-core/workflows/ship.md');
  const reference = read('gsd-core/references/loop-hook-dispatch.md');
  for (const [text, point] of [
    [execute, 'execute:pre'],
    [execute, 'execute:wave:pre'],
    [plan, 'plan:pre'],
    [ship, 'ship:pre'],
  ]) {
    assert.match(text, /produces/);
    assert.match(text, new RegExp(`loop eval-gates ${point.replace(':', '\\:')}`));
  }
  assert.match(reference, /delete artifacts.*dispatch active/s);
  assert.match(reference, /dispatch active.*inject active contributions.*evaluate gates/s);
});
