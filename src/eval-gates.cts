/**
 * Deterministic capability gate evaluation for loop points.
 *
 * The pure evaluator accepts an injected query runner and filesystem so unit
 * tests do not need a project or a subprocess. The CLI wrapper resolves the
 * active hooks with the same loop resolver used by render-hooks.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
import fs = require('node:fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
import path = require('node:path');
// eslint-disable-next-line @typescript-eslint/no-require-imports
import childProcess = require('node:child_process');

// eslint-disable-next-line @typescript-eslint/no-require-imports
import ioMod = require('./io.cjs');
const { output: coreOutput, error: coreError } = ioMod;
// eslint-disable-next-line @typescript-eslint/no-require-imports
import configLoaderModule = require('./config-loader.cjs');
const { loadConfig } = configLoaderModule;
// eslint-disable-next-line @typescript-eslint/no-require-imports
import capabilityStateModule = require('./capability-state.cjs');
const { resolveCapabilityRuntimeState } = capabilityStateModule;
// eslint-disable-next-line @typescript-eslint/no-require-imports
import loopResolver = require('./loop-resolver.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
import capabilityLoaderModule = require('./capability-loader.cjs');
const { loadRegistry } = capabilityLoaderModule;

interface GateHook {
  capId?: unknown;
  blocking?: unknown;
  onError?: unknown;
  check?: unknown;
}

interface GateContext {
  cwd: string;
  phase?: string;
  config?: Record<string, unknown>;
}

interface GateResult {
  capId: string;
  blocking: boolean;
  block: boolean;
  message: string;
  onError: string;
  advisory?: boolean;
  details?: Record<string, unknown>;
}

interface GateDeps {
  exists?: (filePath: string) => boolean;
  readFile?: (filePath: string) => string;
  runQuery?: (query: string, phase: string | undefined, context: GateContext) => unknown;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nestedValue(root: Record<string, unknown>, key: string): { found: boolean; value?: unknown } {
  let current: unknown = root;
  for (const segment of key.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return { found: false };
    const record = current as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, segment)) return { found: false };
    current = record[segment];
  }
  return { found: true, value: current };
}

function evaluateArtifactExists(predicate: Record<string, unknown>, context: GateContext, deps: GateDeps): GateResult {
  // `artifact` is the documented manifest key. Keep `path` as a compatibility
  // alias for older declarations, but prefer the canonical key when both exist.
  const relativePath = predicate['artifact'] ?? predicate['path'];
  if (typeof relativePath !== 'string' || relativePath.trim().length === 0) {
    throw new Error('artifact-exists predicate requires a non-empty string "artifact"');
  }
  const expected = predicate['exists'] === undefined ? true : predicate['exists'];
  if (typeof expected !== 'boolean') throw new Error('artifact-exists predicate "exists" must be boolean');
  const absolutePath = path.resolve(context.cwd, relativePath);
  const exists = (deps.exists ?? fs.existsSync)(absolutePath);
  return {
    capId: '', blocking: false, block: exists !== expected,
    message: exists === expected
      ? `artifact exists as expected: ${relativePath}`
      : `artifact existence mismatch: ${relativePath} (expected ${String(expected)}, found ${String(exists)})`,
    onError: 'skip',
    // Retain details.path for consumers of the pre-canonical result shape.
    details: { kind: 'artifact-exists', artifact: relativePath, path: relativePath, exists, expected },
  };
}

function evaluateConfigEquals(predicate: Record<string, unknown>, context: GateContext): GateResult {
  const key = predicate['key'];
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw new Error('config-equals predicate requires a non-empty string "key"');
  }
  if (!Object.prototype.hasOwnProperty.call(predicate, 'value')) {
    throw new Error('config-equals predicate requires a "value"');
  }
  const config = context.config ?? {};
  const actual = nestedValue(config, key);
  const expected = predicate['value'];
  const matches = actual.found && Object.is(actual.value, expected);
  return {
    capId: '', blocking: false, block: !matches,
    message: matches
      ? `config equals ${key}`
      : `config mismatch for ${key}: expected ${JSON.stringify(expected)}, found ${actual.found ? JSON.stringify(actual.value) : '<unset>'}`,
    onError: 'skip',
    details: { kind: 'config-equals', key, expected, actual: actual.found ? actual.value : undefined },
  };
}

// Minimal line-based frontmatter parse (top-level scalar keys only), matching
// the shape used by first-party artifacts like SECURITY.md (`threats_open: 0`).
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function parseFrontmatterScalars(content: string): Record<string, string> {
  const m = content.match(FRONTMATTER_RE);
  if (!m) return {};
  const data: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!kv) continue;
    data[kv[1]] = kv[2].trim();
  }
  return data;
}

function frontmatterValueMatches(raw: string, expected: unknown): boolean {
  if (typeof expected === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) && Object.is(n, expected);
  }
  if (typeof expected === 'boolean') {
    return (raw === 'true' && expected === true) || (raw === 'false' && expected === false);
  }
  if (expected === null) return raw === 'null' || raw === '~' || raw === '';
  const unquoted = raw.replace(/^(['"])(.*)\1$/, '$2');
  return raw === String(expected) || unquoted === String(expected);
}

function evaluateArtifactFrontmatterEquals(predicate: Record<string, unknown>, context: GateContext, deps: GateDeps): GateResult {
  const relativePath = predicate['artifact'] ?? predicate['path'];
  if (typeof relativePath !== 'string' || relativePath.trim().length === 0) {
    throw new Error('artifact-frontmatter-equals predicate requires a non-empty string "artifact"');
  }
  const field = predicate['field'];
  if (typeof field !== 'string' || field.trim().length === 0) {
    throw new Error('artifact-frontmatter-equals predicate requires a non-empty string "field"');
  }
  if (!Object.prototype.hasOwnProperty.call(predicate, 'equals')) {
    throw new Error('artifact-frontmatter-equals predicate requires an "equals" value');
  }
  const expected = predicate['equals'];
  const absolutePath = path.resolve(context.cwd, relativePath);
  const exists = (deps.exists ?? fs.existsSync)(absolutePath);
  const detailsBase = { kind: 'artifact-frontmatter-equals', artifact: relativePath, field, expected };
  if (!exists) {
    return {
      capId: '', blocking: false, block: true,
      message: `artifact missing for frontmatter check: ${relativePath}`,
      onError: 'skip',
      details: { ...detailsBase, exists: false },
    };
  }
  let content: string;
  try {
    content = (deps.readFile ?? ((p: string) => fs.readFileSync(p, 'utf8')))(absolutePath);
  } catch (err: unknown) {
    throw new Error(`artifact unreadable for frontmatter check: ${relativePath} (${err instanceof Error ? err.message : String(err)})`);
  }
  const data = parseFrontmatterScalars(content);
  const found = Object.prototype.hasOwnProperty.call(data, field);
  const raw = found ? data[field] : undefined;
  const matches = found && frontmatterValueMatches(raw as string, expected);
  return {
    capId: '', blocking: false, block: !matches,
    message: matches
      ? `frontmatter ${field} equals ${JSON.stringify(expected)} in ${relativePath}`
      : found
        ? `frontmatter mismatch for ${field} in ${relativePath}: expected ${JSON.stringify(expected)}, found ${JSON.stringify(raw)}`
        : `frontmatter field ${field} not found in ${relativePath}`,
    onError: 'skip',
    details: { ...detailsBase, exists: true, found, actual: raw },
  };
}

function evaluateGateCheck(check: unknown, context: GateContext, deps: GateDeps = {}): Omit<GateResult, 'capId' | 'blocking' | 'onError'> {
  const checkRecord = asRecord(check);
  if (!checkRecord) throw new Error('gate check must be an object');

  if (Object.prototype.hasOwnProperty.call(checkRecord, 'agentVerdict')) {
    return {
      block: false,
      advisory: true,
      message: 'agentVerdict is advisory and cannot block deterministically',
      details: { kind: 'agentVerdict' },
    };
  }

  const predicate = asRecord(checkRecord['predicate']);
  if (predicate) {
    const kind = predicate['kind'];
    if (kind === 'artifact-exists') return evaluateArtifactExists(predicate, context, deps);
    if (kind === 'config-equals') return evaluateConfigEquals(predicate, context);
    if (kind === 'artifact-frontmatter-equals') return evaluateArtifactFrontmatterEquals(predicate, context, deps);
    throw new Error(`unknown gate predicate kind: ${String(kind)}`);
  }

  const query = checkRecord['query'];
  if (typeof query !== 'string' || query.trim().length === 0) {
    throw new Error('gate check requires query, predicate, or agentVerdict');
  }
  if (typeof deps.runQuery !== 'function') throw new Error('query gate evaluation requires a runQuery dependency');
  const result = asRecord(deps.runQuery(query, context.phase, context)) ?? {};
  return {
    block: result['block'] === true,
    message: typeof result['message'] === 'string' ? result['message'] : `query evaluated: ${query}`,
    details: { kind: 'query', query, result },
  };
}

function evaluateGates(hooks: unknown[], context: GateContext, deps: GateDeps = {}): { point?: string; gates: GateResult[] } {
  const gates: GateResult[] = [];
  for (const rawHook of hooks) {
    const hook = asRecord(rawHook) as GateHook | undefined;
    if (!hook) continue;
    const onError = typeof hook.onError === 'string' ? hook.onError : 'skip';
    let checkResult: Omit<GateResult, 'capId' | 'blocking' | 'onError'>;
    try {
      checkResult = evaluateGateCheck(hook.check, context, deps);
    } catch (err: unknown) {
      const failed = hook.blocking === true && onError === 'halt';
      gates.push({
        capId: typeof hook.capId === 'string' ? hook.capId : '',
        blocking: failed,
        block: failed,
        message: `gate evaluator error: ${err instanceof Error ? err.message : String(err)}`,
        onError,
        details: { kind: 'evaluator-error' },
      });
      continue;
    }
    const blocking = hook.blocking === true && checkResult.advisory !== true;
    gates.push({
      capId: typeof hook.capId === 'string' ? hook.capId : '',
      blocking,
      block: blocking && checkResult.block === true,
      message: checkResult.message,
      onError,
      ...(checkResult.advisory ? { advisory: true } : {}),
      ...(checkResult.details ? { details: checkResult.details } : {}),
    });
  }
  return { gates };
}

/** Delete artifacts declared by active step hooks before a point is dispatched. */
function clearProducedArtifacts(hooks: unknown[], cwd: string): string[] {
  const removed: string[] = [];
  const root = path.resolve(cwd);
  for (const rawHook of hooks) {
    const hook = asRecord(rawHook);
    if (!hook || hook['kind'] !== 'step' || !Array.isArray(hook['produces'])) continue;
    for (const produced of hook['produces']) {
      if (typeof produced !== 'string' || produced.trim().length === 0) continue;
      const target = path.resolve(root, produced);
      if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
        throw new Error(`produced artifact escapes project root: ${produced}`);
      }
      fs.rmSync(target, { force: true, recursive: false });
      removed.push(target);
    }
  }
  return removed;
}

function runCheckQuery(query: string, phase: string | undefined, context: GateContext): unknown {
  const executable = path.resolve(__dirname, '..', 'gsd-tools.cjs');
  const args = ['check', query];
  if (phase) args.push(phase);
  args.push('--raw');
  const stdout = childProcess.execFileSync(process.execPath, [executable, ...args], {
    cwd: context.cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(stdout);
}

function cmdLoopEvalGates(cwd: string, point: string, raw: boolean, options: Record<string, unknown> = {}): void {
  if (!point) {
    coreError('loop eval-gates requires a <point> argument');
    return;
  }
  const configDir = typeof options['configDir'] === 'string' ? options['configDir'] : undefined;
  const runtime = typeof options['runtime'] === 'string' ? options['runtime'] : undefined;
  const phase = typeof options['phase'] === 'string' ? options['phase'] : undefined;
  let config: Record<string, unknown>;
  try { config = loadConfig(cwd); } catch { config = {}; }
  const state = resolveCapabilityRuntimeState(cwd, configDir, config, runtime) as { capabilities?: Array<{ id: string; enabled?: boolean; active: boolean }> };
  const registry = loadRegistry({ includeInstalled: true, cwd, gsdHome: process.env['GSD_HOME'] });
  const states = new Map<string, { enabled?: boolean; active: boolean }>();
  for (const capability of state.capabilities ?? []) states.set(capability.id, capability);
  let resolved: { point: string; activeHooks: unknown[] };
  try {
    resolved = loopResolver.resolveLoopHooks({ point, registry, config, cwd, capabilityStatesById: states });
  } catch (err: unknown) {
    coreError(err instanceof Error ? err.message : String(err));
    return;
  }
  const gateHooks = resolved.activeHooks.filter((hook) => asRecord(hook)?.['kind'] === 'gate');
  let result: { gates: GateResult[] };
  try {
    result = evaluateGates(gateHooks, { cwd, phase, config }, { runQuery: runCheckQuery });
  } catch (err: unknown) {
    coreError(`gate evaluation failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  coreOutput({ point: resolved.point, gates: result.gates }, raw);
}

export = {
  evaluateArtifactExists,
  evaluateConfigEquals,
  evaluateGateCheck,
  evaluateGates,
  clearProducedArtifacts,
  cmdLoopEvalGates,
};
