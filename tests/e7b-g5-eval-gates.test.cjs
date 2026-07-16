'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

const evalGates = require('../gsd-core/bin/lib/eval-gates.cjs');
const { cleanup } = require('./helpers.cjs');
const INSTALL_SCRIPT = path.join(__dirname, '..', 'bin', 'install.js');

function makeInstalledParityCapability(root) {
  const source = path.join(root, 'source');
  fs.mkdirSync(path.join(source, 'skills', 'installed-gate-skill'), { recursive: true });
  fs.writeFileSync(path.join(source, 'skills', 'installed-gate-skill', 'SKILL.md'), '# installed gate skill\n');
  fs.writeFileSync(path.join(source, 'capability.json'), JSON.stringify({
    id: 'e7b-installed-parity-cap',
    role: 'feature',
    version: '1.0.0',
    title: 'installed parity capability',
    description: 'installed-layout AC-6 fixture',
    tier: 'standard',
    requires: [],
    engines: { gsd: '>=1.0.0' },
    runtimeCompat: { supported: ['claude'], unsupported: [] },
    skills: ['installed-gate-skill'],
    agents: [],
    hooks: [],
    config: {},
    steps: [],
    contributions: [],
    gates: [{
      point: 'execute:wave:post',
      check: { predicate: { kind: 'artifact-exists', artifact: 'CLEARANCE.md' } },
      blocking: true,
      onError: 'halt',
    }],
  }));
  return source;
}

test('eval-gates returns deterministic artifact-exists verdicts', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-e7b-g5-'));
  fs.writeFileSync(path.join(cwd, 'clearance.md'), 'fresh');
  const present = evalGates.evaluateGates([
    { capId: 'fixture', kind: 'gate', blocking: true, check: { predicate: { kind: 'artifact-exists', artifact: 'clearance.md' } } },
  ], { cwd });
  const absent = evalGates.evaluateGates([
    { capId: 'fixture', kind: 'gate', blocking: true, check: { predicate: { kind: 'artifact-exists', artifact: 'missing.md' } } },
  ], { cwd });
  assert.equal(present.gates[0].block, false);
  assert.equal(absent.gates[0].block, true);
});

test('installed layout installs project skills and evaluates canonical artifact gates end to end', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-e7b-g5-installed-'));
  const configDir = path.join(root, 'claude');
  const gsdHome = path.join(root, 'home');
  const project = path.join(root, 'project');
  const userHome = path.join(root, 'user-home');
  fs.mkdirSync(project, { recursive: true });
  const env = { ...process.env, HOME: userHome, GSD_HOME: gsdHome, CLAUDE_CONFIG_DIR: configDir };
  try {
    const installed = childProcess.spawnSync(process.execPath, [
      INSTALL_SCRIPT, '--claude', '--global', '--config-dir', configDir, '--no-sdk', '--yes',
    ], { cwd: path.join(__dirname, '..'), env, encoding: 'utf8' });
    assert.equal(installed.status, 0, installed.stderr || installed.stdout);
    assert.equal(fs.existsSync(path.join(configDir, 'capabilities')), false);

    const source = makeInstalledParityCapability(root);
    const tools = path.join(configDir, 'gsd-core', 'bin', 'gsd-tools.cjs');
    const install = childProcess.spawnSync(process.execPath, [
      tools, 'capability', 'install', source, '--scope', 'project', '--runtime', 'claude',
      '--config-dir', configDir, '--yes', '--raw',
    ], { cwd: project, env, encoding: 'utf8' });
    assert.equal(install.status, 0, install.stderr || install.stdout);
    assert.equal(
      fs.readFileSync(path.join(configDir, 'skills', 'gsd-installed-gate-skill', 'SKILL.md'), 'utf8'),
      '# installed gate skill\n',
    );

    const gate = childProcess.spawnSync(process.execPath, [
      tools, 'loop', 'eval-gates', 'execute:wave:post', '--config-dir', configDir, '--raw',
    ], { cwd: project, env, encoding: 'utf8' });
    assert.equal(gate.status, 0, gate.stderr || gate.stdout);
    const result = JSON.parse(gate.stdout);
    const installedGate = result.gates.find((entry) => entry.capId === 'e7b-installed-parity-cap');
    assert.ok(installedGate, JSON.stringify(result));
    assert.equal(installedGate.block, true);
    assert.equal(installedGate.details.artifact, 'CLEARANCE.md');
  } finally {
    cleanup(root);
  }
});

test('eval-gates returns deterministic config-equals match and mismatch', () => {
  const context = { cwd: process.cwd(), config: { workflow: { mode: 'strict' } } };
  const match = evalGates.evaluateGates([
    { capId: 'fixture', kind: 'gate', blocking: true, check: { predicate: { kind: 'config-equals', key: 'workflow.mode', value: 'strict' } } },
  ], context);
  const mismatch = evalGates.evaluateGates([
    { capId: 'fixture', kind: 'gate', blocking: true, check: { predicate: { kind: 'config-equals', key: 'workflow.mode', value: 'permissive' } } },
  ], context);
  assert.equal(match.gates[0].block, false);
  assert.equal(mismatch.gates[0].block, true);
});

test('eval-gates evaluates query checks and downgrades agentVerdict to advisory', () => {
  const query = evalGates.evaluateGates([
    { capId: 'query-cap', kind: 'gate', blocking: true, check: { query: 'fixture-check' } },
  ], { cwd: process.cwd(), phase: '7' }, {
    runQuery(name, phase) {
      assert.equal(name, 'fixture-check');
      assert.equal(phase, '7');
      return { block: true, message: 'fixture query failed' };
    },
  });
  const advisory = evalGates.evaluateGates([
    { capId: 'agent-cap', kind: 'gate', blocking: true, check: { agentVerdict: { ref: 'fixture-agent' } } },
  ], { cwd: process.cwd() });
  assert.equal(query.gates[0].block, true);
  assert.equal(advisory.gates[0].block, false);
  assert.equal(advisory.gates[0].advisory, true);
});

test('eval-gates evaluates artifact-frontmatter-equals (first-party security gate shape)', () => {
  const files = {
    '/proj/SECURITY.md': '---\nthreats_open: 0\naudited: true\n---\n\n# Security\n',
    '/proj/OPEN.md': '---\nthreats_open: 2\n---\n',
    '/proj/NOFM.md': '# no frontmatter\n',
  };
  const deps = {
    exists: (p) => Object.prototype.hasOwnProperty.call(files, p),
    readFile: (p) => files[p],
  };
  const gate = (artifact, field, equals) => ({
    capId: 'security', kind: 'gate', blocking: true,
    check: { predicate: { kind: 'artifact-frontmatter-equals', artifact, field, equals } },
  });
  const ctx = { cwd: '/proj' };
  const pass = evalGates.evaluateGates([gate('SECURITY.md', 'threats_open', 0)], ctx, deps);
  assert.equal(pass.gates[0].block, false);
  const boolPass = evalGates.evaluateGates([gate('SECURITY.md', 'audited', true)], ctx, deps);
  assert.equal(boolPass.gates[0].block, false);
  const mismatch = evalGates.evaluateGates([gate('OPEN.md', 'threats_open', 0)], ctx, deps);
  assert.equal(mismatch.gates[0].block, true);
  const missingField = evalGates.evaluateGates([gate('NOFM.md', 'threats_open', 0)], ctx, deps);
  assert.equal(missingField.gates[0].block, true);
  const missingFile = evalGates.evaluateGates([gate('ABSENT.md', 'threats_open', 0)], ctx, deps);
  assert.equal(missingFile.gates[0].block, true);
});
