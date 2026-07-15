# e7b-generic-capability-repair

Base: next @ a68f1be1 (1.7.0-rc.6). Purpose: complete gsd-core's GENERIC third-party
capability lifecycle so that documented extension points behave as documented. No
context-graph-specific behavior may be added anywhere (AC-7); this fork repairs the
mechanism, not the consumer.

## Gaps (verified live against a68f1be1)

- G1: `capability install` cross-validation rejects explicit runtime ids
  (`runtimeCompat.supported: ["claude"]` -> "unknown runtime"): the validator builds
  `runtimeIds` only from role=runtime capabilities present in the validated set, and the
  install path never includes them. Site: src/capability-validator.cts (crossValidate),
  install path in src/capability-lifecycle.cts.
- G2: capability-owned skills are never physically surfaced: `capability install/enable`
  reports surfaced/active but writes no skill files to the runtime surface
  (`<configDir>/skills/gsd-<stem>/SKILL.md` for Claude), so the runtime's Skill tool
  cannot load them. Sites: src/capability-lifecycle.cts, src/capability-writer.cts
  (materialize/applySurface machinery exists and is unused by install), src/surface.cts.
- G3: `execute:pre` and `execute:wave:pre` are declared in
  gsd-core/workflows/execute-phase.md frontmatter `points:` but never rendered or
  dispatched in the body. (plan:post, discuss:pre/post, verify:pre/post, ship:pre/post,
  execute:post, execute:wave:post are rendered.)
- G4: third-party step/contribution dispatch is inconsistent across points:
  plan:pre steps dispatch only "when pipeline mode allows auto-chaining"; ship:pre steps
  are never dispatched (ship.md consumes SHIP_PRE_HOOKS_JSON solely for the hardcoded
  security gate).
- G5: third-party blocking gates are not deterministically enforceable anywhere:
  ship.md hardcodes capId=="security"; execute:wave:post gate handling evaluates only
  `check.query` via `gsd_run check <name>` whose subcommand set is closed first-party;
  the `predicate` check form is documented (docs + references/loop-hook-dispatch.md) but
  never evaluated by any shipped workflow.
- G6: no defined ordering between steps, contributions, and gates at a point; a stale
  step-produced artifact from a previous pass can satisfy a later `artifact-exists` gate.

## Design (generic; keep first-party behavior compatible)

1. `gsd-tools loop eval-gates <point> [--phase <n>] [--cwd ...] [--config-dir ...] --raw`
   NEW deterministic subcommand: resolves active gate hooks at <point> and evaluates
   `query` (existing check router) and `predicate` forms (`artifact-exists`,
   `config-equals`) in code, returning JSON
   `{point, gates:[{capId, blocking, block, message, onError}]}`.
   `artifact-exists` resolves relative to the project root; document this. `agentVerdict`
   gates are returned with `block:false, advisory:true` (never deterministic).
2. Point-runner ordering contract (document in references/loop-hook-dispatch.md and apply
   in workflows): at each rendered point, in order:
   (a) delete files declared in `produces` of the point's ACTIVE step hooks (stale-artifact
   protection, AC-4); (b) dispatch steps in array order; (c) inject contributions;
   (d) evaluate gates via `loop eval-gates`; blocking gates with block==true halt the
   workflow deterministically (the workflow surfaces the JSON verdict; onError only covers
   evaluator command failure).
3. Workflows: add rendering+dispatch at execute:pre and execute:wave:pre (both worktree and
   sequential executor paths) in execute-phase.md; add generic step dispatch + eval-gates to
   ship.md at ship:pre (before the existing security prose, which keeps working); make
   plan:pre third-party step dispatch unconditional (first-party special cases — research,
   pattern-mapper, ai-integration, ui — keep their existing documented semantics; a
   third-party step is any capId without a special case in that workflow).
4. G1: thread the full merged registry (including role=runtime capabilities from the
   package's capabilities/ tree and the installed runtime set) into install-time
   cross-validation, so explicit runtime ids validate; unknown ids must still fail.
5. G2: `capability install` and `capability enable` materialize owned skill files onto the
   runtime surface (Claude: `<configDir>/skills/gsd-<stem>/SKILL.md`, plus whatever other
   runtimes' descriptors define); `capability remove`/`disable` withdraw them; never
   overwrite a first-party skill dir; idempotent.
6. Parity (AC-6): behaviors above must be identical from a source tree and from an
   installed layout; extend/regress-test with an installed-layout fixture.

## Acceptance criteria

- AC-1: plan:pre, execute:pre, execute:wave:pre, execute:wave:post, verify:pre, verify:post,
  ship:pre, ship:post dispatch third-party hooks (steps, contributions, gates as applicable)
  — workflow-text assertions + eval-gates unit tests.
- AC-2: steps execute before contributions are consumed and before gates are evaluated, in a
  deterministic documented order (references/loop-hook-dispatch.md updated; tests assert the
  runner contract text and eval-gates behavior).
- AC-3: a third-party blocking gate halts progression without relying on the model: eval-gates
  returns block:true deterministically for a failing predicate/query and the workflow contract
  mandates the halt; unit tests cover predicate artifact-exists (present/absent) and
  config-equals (match/mismatch) and agentVerdict advisory downgrade.
- AC-4: a stale clearance artifact cannot satisfy a later gate: with a pre-existing artifact
  and a step at the same point declaring it in `produces`, the runner deletes it before step
  dispatch; eval-gates sees only the fresh artifact. Unit test.
- AC-5: after `capability install` of a fixture capability owning skills, the skill files
  exist under the isolated `<configDir>/skills/gsd-<stem>/SKILL.md`; removed on
  remove/disable; never clobbers first-party dirs. Unit tests.
- AC-6: installed-package behavior matches source-tree behavior for install, enable/disable,
  render-hooks, eval-gates (installed-layout fixture test).
- AC-7: no context-graph-specific code: repository-wide test asserting no occurrence of
  "context-graph", "context_graph", or "cg " command invocations in src/, gsd-core/workflows/,
  bin/ (fixtures/tests may use neutral fixture ids only).
- AC-8: existing suite passes: npm run build:lib && npm run lint && node scripts/run-tests.cjs
  with zero failures.

## Commit shape

One commit per gap (G1..G6 + docs), each self-contained and upstream-PR-shaped:
fix(capability): ... / feat(loop): ... / docs(loop): ... Each commit adds its regression
test(s). No unrelated changes, no reformatting sweeps.
