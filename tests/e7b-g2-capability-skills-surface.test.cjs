'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runGsdTools, cleanup } = require('./helpers.cjs');

function fixture(root) {
  const source = path.join(root, 'source');
  fs.mkdirSync(path.join(source, 'skills', 'owned-skill'), { recursive: true });
  fs.writeFileSync(path.join(source, 'skills', 'owned-skill', 'SKILL.md'), '# owned skill\n');
  fs.writeFileSync(path.join(source, 'capability.json'), JSON.stringify({
    id: 'e7b-skill-cap',
    role: 'feature',
    version: '1.0.0',
    title: 'e7b skill capability',
    description: 'physical skill surface fixture',
    tier: 'standard',
    requires: [],
    engines: { gsd: '>=1.0.0' },
    runtimeCompat: { supported: ['claude'], unsupported: [] },
    skills: ['owned-skill', 'plan-phase'],
    agents: [],
    hooks: [],
    config: {},
    steps: [],
    contributions: [],
    gates: [],
  }));
  return source;
}

function run(args, cwd, home, configDir) {
  return runGsdTools(args, cwd, {
    GSD_HOME: home,
    CLAUDE_CONFIG_DIR: configDir,
    GSD_WORKSTREAM: '',
    GSD_PROJECT: '',
  });
}

test('capability install/enable/remove physically manages owned Claude skills without clobbering first-party skills', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'e7b-g2-'));
  const home = path.join(root, 'home');
  const configDir = path.join(root, 'claude');
  const cwd = path.join(root, 'project');
  fs.mkdirSync(path.join(cwd, '.planning'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.planning', 'config.json'), '{}');
  const firstParty = path.join(configDir, 'skills', 'gsd-plan-phase', 'SKILL.md');
  fs.mkdirSync(path.dirname(firstParty), { recursive: true });
  fs.writeFileSync(firstParty, 'first-party-original\n');

  try {
    const source = fixture(root);
    const installed = run(['capability', 'install', source, '--scope', 'global', '--runtime', 'claude', '--config-dir', configDir, '--raw'], cwd, home, configDir);
    assert.equal(installed.success, true, installed.error || installed.output);
    assert.equal(fs.readFileSync(path.join(configDir, 'skills', 'gsd-owned-skill', 'SKILL.md'), 'utf8'), '# owned skill\n');
    assert.equal(fs.readFileSync(firstParty, 'utf8'), 'first-party-original\n');

    const disabled = run(['capability', 'disable', 'e7b-skill-cap', '--scope', 'global', '--runtime', 'claude', '--config-dir', configDir, '--raw'], cwd, home, configDir);
    assert.equal(disabled.success, true, disabled.error || disabled.output);
    assert.equal(fs.existsSync(path.join(configDir, 'skills', 'gsd-owned-skill')), false);
    assert.equal(fs.readFileSync(firstParty, 'utf8'), 'first-party-original\n');

    const enabled = run(['capability', 'enable', 'e7b-skill-cap', '--scope', 'global', '--runtime', 'claude', '--config-dir', configDir, '--raw'], cwd, home, configDir);
    assert.equal(enabled.success, true, enabled.error || enabled.output);
    assert.equal(fs.existsSync(path.join(configDir, 'skills', 'gsd-owned-skill', 'SKILL.md')), true);

    const removed = run(['capability', 'remove', 'e7b-skill-cap', '--scope', 'global', '--runtime', 'claude', '--config-dir', configDir, '--raw'], cwd, home, configDir);
    assert.equal(removed.success, true, removed.error || removed.output);
    assert.equal(fs.existsSync(path.join(configDir, 'skills', 'gsd-owned-skill')), false);
    assert.equal(fs.readFileSync(firstParty, 'utf8'), 'first-party-original\n');

    const project = path.join(root, 'project');
    fs.mkdirSync(project, { recursive: true });
    const projectInstalled = run(['capability', 'install', source, '--scope', 'project', '--runtime', 'claude', '--config-dir', configDir, '--raw'], project, home, configDir);
    assert.equal(projectInstalled.success, true, projectInstalled.error || projectInstalled.output);
    assert.equal(fs.existsSync(path.join(configDir, 'skills', 'gsd-owned-skill', 'SKILL.md')), true);
  } finally {
    cleanup(root);
  }
});
