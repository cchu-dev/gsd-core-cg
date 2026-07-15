'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { cleanup } = require('./helpers.cjs');
const { resolveCapabilitySource } = require('../gsd-core/bin/lib/capability-source.cjs');

function makeCapability(id, runtimeId) {
  return {
    id,
    role: 'feature',
    version: '1.0.0',
    title: id,
    description: 'runtime compatibility fixture',
    tier: 'standard',
    requires: [],
    engines: { gsd: '>=1.0.0' },
    runtimeCompat: { supported: [runtimeId], unsupported: [] },
    skills: [],
    agents: [],
    hooks: [],
    config: {},
    steps: [],
    contributions: [],
    gates: [],
  };
}

test('install-time validation recognizes bundled runtime capability ids', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'e7b-g1-'));
  const source = path.join(root, 'source');
  const gsdHome = path.join(root, 'home');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'capability.json'), JSON.stringify(makeCapability('e7b-runtime-cap', 'claude')));

  try {
    const result = await resolveCapabilitySource(source, { gsdHome, hostVersion: '1.7.0' });
    assert.equal(result.id, 'e7b-runtime-cap');
  } finally {
    cleanup(root);
  }
});

test('install-time validation still rejects an unknown explicit runtime id', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'e7b-g1-'));
  const source = path.join(root, 'source');
  const gsdHome = path.join(root, 'home');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'capability.json'), JSON.stringify(makeCapability('e7b-unknown-runtime-cap', 'not-a-runtime')));

  try {
    await assert.rejects(
      resolveCapabilitySource(source, { gsdHome, hostVersion: '1.7.0' }),
      /unknown runtime "not-a-runtime"/,
    );
  } finally {
    cleanup(root);
  }
});
