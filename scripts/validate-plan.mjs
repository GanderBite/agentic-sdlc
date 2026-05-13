#!/usr/bin/env node
// validate-plan.mjs — §19.1 plan validator.
//
// Usage:
//   node scripts/validate-plan.mjs <sprint.json> [<tasks.json>] [<waves.json>]
//
// Inputs are paths; if only sprint is passed, sibling tasks/waves are
// resolved next to it as `<sprint>.tasks.json` / `<sprint>.waves.json`.
//
// Exit: 0 ok, 1 invalid. Errors are emitted to stderr as one JSON object
// per line so the LLM can machine-read them.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';

const args = process.argv.slice(2);
if (args.length === 0) {
  process.stderr.write('usage: validate-plan.mjs <sprint.json> [<tasks.json>] [<waves.json>]\n');
  process.exit(1);
}

const errors = [];
const emit = (severity, code, message, extra = {}) => {
  errors.push({ severity, code, message, ...extra });
};

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    emit('blocking', 'parse_error', `cannot parse ${path}: ${err.message}`, { path });
    return null;
  }
};

const sprintPath = resolve(args[0]);
const projectRoot = (() => {
  // walk up to find a `.planning` ancestor — handy when inputs are absolute.
  let dir = dirname(sprintPath);
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, '.planning'))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
})();

const tasksPath = resolve(args[1] ?? sprintPath.replace(/\.json$/, '.tasks.json'));
const wavesPath = resolve(args[2] ?? sprintPath.replace(/\.json$/, '.waves.json'));

const sprint = readJson(sprintPath);
const tasksDoc = existsSync(tasksPath) ? readJson(tasksPath) : null;
const wavesDoc = existsSync(wavesPath) ? readJson(wavesPath) : null;

if (!sprint) finish();

// --- Sprint-level checks ---------------------------------------------------
if (!sprint.id || !/^sprint-[a-z0-9-]+$/i.test(sprint.id)) {
  emit('blocking', 'sprint_id_invalid', `sprint.id must match /^sprint-[a-z0-9-]+$/, got ${JSON.stringify(sprint.id)}`);
}
if (!Array.isArray(sprint.waves) || sprint.waves.length === 0) {
  emit('blocking', 'sprint_waves_empty', 'sprint.waves must be a non-empty array of wave ids');
}

// --- Tasks-level checks ----------------------------------------------------
const tasks = (tasksDoc && Array.isArray(tasksDoc.tasks)) ? tasksDoc.tasks : [];
const taskById = new Map();
const seenIds = new Set();
for (const t of tasks) {
  if (!t || typeof t.id !== 'string') {
    emit('blocking', 'task_missing_id', 'task entry missing id');
    continue;
  }
  if (seenIds.has(t.id)) {
    emit('blocking', 'task_id_duplicate', `duplicate task id: ${t.id}`, { task_id: t.id });
  }
  seenIds.add(t.id);
  taskById.set(t.id, t);
}

// Skill registry presence check.
let skillNames = null;
const indexPath = join(projectRoot, '.claude/skills/INDEX.json');
if (existsSync(indexPath)) {
  const index = readJson(indexPath);
  if (index && Array.isArray(index.skills)) {
    skillNames = new Set(index.skills.map((s) => s.name));
  }
}

// build-graph commands.
let buildGraphCmds = null;
const bgPath = join(projectRoot, '.planning/intel/build-graph.json');
if (existsSync(bgPath)) {
  const bg = readJson(bgPath);
  if (bg) {
    const cmds = new Set();
    const collect = (val) => {
      if (Array.isArray(val)) val.forEach(collect);
      else if (val && typeof val === 'object') Object.values(val).forEach(collect);
      else if (typeof val === 'string') cmds.add(val);
    };
    collect(bg.global ?? {});
    collect(bg.per_module ?? {});
    buildGraphCmds = cmds;
  }
}
const builtinTokens = new Set(['rg', 'node', 'bash', 'sh', 'echo', 'cat', 'true', 'false']);

for (const t of tasks) {
  if (!t) continue;
  // skill names
  if (Array.isArray(t.skills) && skillNames) {
    for (const s of t.skills) {
      if (!skillNames.has(s)) {
        emit('blocking', 'skill_not_in_index', `task ${t.id} references unknown skill: ${s}`, { task_id: t.id, skill: s });
      }
    }
  }
  // verification commands
  const ver = t.verification ?? {};
  for (const kind of ['tests', 'lint', 'build']) {
    const list = ver[kind];
    if (!Array.isArray(list)) continue;
    for (const cmd of list) {
      if (typeof cmd !== 'string') continue;
      if (buildGraphCmds && !buildGraphCmds.has(cmd)) {
        const head = cmd.split(/\s+/)[0];
        if (!builtinTokens.has(head)) {
          emit('high', 'verification_cmd_unknown', `task ${t.id} references command not in build-graph.json: ${cmd}`, { task_id: t.id, cmd });
        }
      }
    }
  }
}

// Dependency cycles (Tarjan-ish quick version).
const adj = new Map();
for (const t of tasks) {
  if (!t || !t.id) continue;
  adj.set(t.id, Array.isArray(t.depends_on) ? t.depends_on.filter((d) => taskById.has(d)) : []);
}
const cycle = findCycle(adj);
if (cycle) {
  emit('blocking', 'task_dependency_cycle', `cycle in depends_on: ${cycle.join(' → ')}`, { cycle });
}

// --- Waves-level checks ----------------------------------------------------
const waves = (wavesDoc && Array.isArray(wavesDoc.waves)) ? wavesDoc.waves : [];
const waveById = new Map(waves.map((w) => [w?.id, w]));

// Sprint references waves that exist.
if (Array.isArray(sprint.waves)) {
  for (const wid of sprint.waves) {
    if (!waveById.has(wid)) {
      emit('blocking', 'sprint_wave_missing', `sprint.waves references unknown wave: ${wid}`, { wave_id: wid });
    }
  }
}

// Per-wave invariants (§5.2).
for (const w of waves) {
  if (!w || !w.id) continue;
  if (!Array.isArray(w.tasks) || w.tasks.length === 0) {
    emit('blocking', 'wave_tasks_empty', `wave ${w.id} has no tasks`, { wave_id: w.id });
    continue;
  }
  // 1. No in-wave depends_on.
  const inWave = new Set(w.tasks);
  for (const tid of w.tasks) {
    const t = taskById.get(tid);
    if (!t) {
      emit('blocking', 'wave_task_missing', `wave ${w.id} references unknown task: ${tid}`, { wave_id: w.id, task_id: tid });
      continue;
    }
    for (const d of t.depends_on ?? []) {
      if (inWave.has(d)) {
        emit('blocking', 'wave_internal_dependency', `wave ${w.id}: task ${tid} depends on ${d} in the same wave`, { wave_id: w.id, task_id: tid, depends_on: d });
      }
    }
  }
  // 2. target_files disjoint (excluding may_also_touch).
  const seenFiles = new Map();
  for (const tid of w.tasks) {
    const t = taskById.get(tid);
    if (!t) continue;
    const tf = t.target_files ?? {};
    const owned = [
      ...(tf.create ?? []),
      ...(tf.update ?? []),
      ...(tf.remove ?? []),
    ];
    for (const f of owned) {
      if (seenFiles.has(f)) {
        emit('blocking', 'wave_target_files_overlap', `wave ${w.id}: file ${f} claimed by both ${seenFiles.get(f)} and ${tid}`, { wave_id: w.id, file: f, tasks: [seenFiles.get(f), tid] });
      } else {
        seenFiles.set(f, tid);
      }
    }
  }
  // 3. Token budget.
  if (typeof w.token_budget === 'number') {
    const sum = w.tasks.reduce((acc, tid) => acc + (taskById.get(tid)?.estimate_tokens ?? 0), 0);
    if (sum > w.token_budget) {
      emit('high', 'wave_token_budget_exceeded', `wave ${w.id}: estimate sum ${sum} > budget ${w.token_budget}`, { wave_id: w.id, sum, budget: w.token_budget });
    }
  }
  // 4. Parallelism cap.
  if (typeof w.max_parallelism === 'number' && (w.max_parallelism < 1 || w.max_parallelism > 8)) {
    emit('medium', 'wave_parallelism_out_of_range', `wave ${w.id}: max_parallelism=${w.max_parallelism} outside [1,8]`, { wave_id: w.id });
  }
  // 5. Contracts satisfied earlier.
  // The position of this wave in the sprint:
  const idx = (sprint.waves ?? []).indexOf(w.id);
  if (idx >= 0) {
    const earlierWaves = (sprint.waves ?? []).slice(0, idx).map((id) => waveById.get(id)).filter(Boolean);
    const satisfiedContracts = new Set(
      earlierWaves
        .filter((ew) => ew.kind === 'contract')
        .flatMap((ew) => ew.tasks)
        .map((tid) => taskById.get(tid)?.id)
        .filter(Boolean),
    );
    for (const tid of w.tasks) {
      const t = taskById.get(tid);
      if (!t) continue;
      for (const c of t.depends_on_contracts ?? []) {
        if (!satisfiedContracts.has(c)) {
          emit('high', 'wave_contract_unsatisfied', `wave ${w.id}: task ${tid} depends_on_contracts ${c} not produced by an earlier wave`, { wave_id: w.id, task_id: tid, contract: c });
        }
      }
    }
  }
}

// 6. Smoke wave is the last wave.
if (Array.isArray(sprint.waves) && sprint.waves.length > 0) {
  const last = sprint.waves[sprint.waves.length - 1];
  const lastWave = waveById.get(last);
  if (!lastWave || lastWave.kind !== 'review') {
    emit('blocking', 'smoke_wave_missing', `last wave (${last}) must have kind="review" (smoke)`, { wave_id: last });
  }
}

// 7. Contract gating (§5.4): not strict in v1, just warn if a contract wave
//    has fewer than 3 dependents in the next wave.
for (const w of waves) {
  if (!w || w.kind !== 'contract') continue;
  const idx = (sprint.waves ?? []).indexOf(w.id);
  const nextId = (sprint.waves ?? [])[idx + 1];
  const nextWave = nextId ? waveById.get(nextId) : null;
  if (!nextWave) continue;
  const consumers = new Set();
  for (const tid of (nextWave.tasks ?? [])) {
    const t = taskById.get(tid);
    if (!t) continue;
    for (const c of t.depends_on_contracts ?? []) {
      if ((w.tasks ?? []).includes(c)) consumers.add(tid);
    }
  }
  if (consumers.size < 3) {
    emit('medium', 'contract_underused', `contract wave ${w.id}: only ${consumers.size} dependent tasks in the next wave (§5.4 guideline ≥3)`, { wave_id: w.id, consumers: [...consumers] });
  }
}

// 8. Coverage (§5.2 acceptance bullets).
const coveragePath = join(projectRoot, '.planning/sprints/_last_coverage.json');
if (existsSync(coveragePath)) {
  const cov = readJson(coveragePath);
  if (cov?.verdict === 'fail') {
    emit('blocking', 'coverage_fail', `_last_coverage.json reports verdict=fail with ${cov.gaps?.length ?? 0} gap(s)`, { gaps: cov.gaps });
  }
}

// 9. Enforced wave-invariant hints (§11.3).
const priorsPath = join(projectRoot, '.planning/estimation_priors.json');
if (existsSync(priorsPath)) {
  const priors = readJson(priorsPath);
  const hints = (priors?.wave_invariant_hints ?? []).filter((h) => h.enforced);
  for (const hint of hints) {
    let re;
    try { re = new RegExp(hint.pattern); } catch { continue; }
    for (const w of waves) {
      const fileSet = new Set();
      for (const tid of (w.tasks ?? [])) {
        const t = taskById.get(tid);
        if (!t) continue;
        const tf = t.target_files ?? {};
        for (const f of [...(tf.create ?? []), ...(tf.update ?? [])]) {
          if (re.test(f)) fileSet.add(f);
        }
      }
      if (fileSet.size > 1) {
        emit('blocking', 'enforced_hint_violated', `wave ${w.id}: hint "${hint.advice ?? hint.pattern}" violated by ${[...fileSet].join(', ')}`, { wave_id: w.id, hint });
      }
    }
  }
}

finish();

function finish() {
  for (const e of errors) {
    process.stderr.write(JSON.stringify(e) + '\n');
  }
  const blocking = errors.filter((e) => e.severity === 'blocking').length;
  if (blocking > 0) {
    process.stderr.write(`validate-plan: ${blocking} blocking error(s); ${errors.length - blocking} other\n`);
    process.exit(1);
  }
  process.exit(0);
}

function findCycle(adj) {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  for (const k of adj.keys()) color.set(k, WHITE);
  const stack = [];
  const dfs = (node) => {
    color.set(node, GRAY);
    stack.push(node);
    for (const next of adj.get(node) ?? []) {
      if ((color.get(next) ?? WHITE) === GRAY) {
        const start = stack.indexOf(next);
        return stack.slice(start).concat(next);
      }
      if ((color.get(next) ?? WHITE) === WHITE) {
        const c = dfs(next);
        if (c) return c;
      }
    }
    stack.pop();
    color.set(node, BLACK);
    return null;
  };
  for (const k of adj.keys()) {
    if (color.get(k) === WHITE) {
      const c = dfs(k);
      if (c) return c;
    }
  }
  return null;
}
