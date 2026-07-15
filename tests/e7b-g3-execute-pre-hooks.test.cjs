'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs.readFileSync(path.join(__dirname, '..', 'gsd-core', 'workflows', 'execute-phase.md'), 'utf8');

test('execute workflow renders and dispatches execute:pre before executor work', () => {
  assert.match(workflow, /EXECUTE_PRE_HOOKS_JSON=\$\(gsd_run loop render-hooks execute:pre --raw\)/);
  assert.match(workflow, /Execute:pre capability dispatch/);
  assert.match(workflow, /Skill\(skill="gsd-\$\{ref\.skill\}"/);
  assert.match(workflow, /ref\.agent/);
});

test('execute workflow renders execute:wave:pre before both executor modes', () => {
  assert.match(workflow, /WAVE_PRE_HOOKS_JSON=\$\(gsd_run loop render-hooks execute:wave:pre --raw\)/);
  assert.match(workflow, /before either executor path/);
  assert.match(workflow, /execute:wave:pre.*worktree/s);
  assert.match(workflow, /execute:wave:pre.*sequential/s);
});
