'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const forbidden = /context-graph|context_graph|cg /i;

function filesUnder(root) {
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...filesUnder(fullPath));
    else if (entry.isFile()) result.push(fullPath);
  }
  return result;
}

test('source and shipped workflows contain no graph-specific integration', () => {
  const root = path.join(__dirname, '..');
  const scoped = ['src', 'gsd-core/workflows', 'bin'].flatMap((relative) => filesUnder(path.join(root, relative)));
  const violations = [];
  for (const file of scoped) {
    const text = fs.readFileSync(file, 'utf8');
    if (forbidden.test(text)) violations.push(path.relative(root, file));
  }
  assert.deepEqual(violations, []);
});
