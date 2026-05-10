#!/usr/bin/env node
// validate-state.mjs — §19.4 state validator.
//
// Usage:
//   node scripts/validate-state.mjs <state.json>
//
// Runs at sprint resume per §8 / §19.4.

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';

const argv = process.argv.slice(2);
if (argv.length === 0) {
  process.stderr.write('usage: validate-state.mjs <state.json>\n');
  process.exit(1);
}

const errors = [];
const emit = (severity, code, message, extra = {}) =>
  errors.push({ severity, code, message, ...extra });

const statePath = resolve(argv[0]);
let state;
try { state = JSON.parse(readFileSync(statePath, 'utf8')); }
catch (e) {
  process.stderr.write(JSON.stringify({ severity: 'blocking', code: 'parse_error', message: e.message }) + '\n');
  process.exit(1);
}

// Find project root (walks up to find .git).
const projectRoot = (() => {
  let d = dirname(statePath);
  while (d !== dirname(d)) {
    if (existsSync(join(d, '.git'))) return d;
    d = dirname(d);
  }
  return process.cwd();
})();

if (typeof state.schema_version !== 'number' || state.schema_version < 1) {
  emit('blocking', 'schema_version_invalid', `schema_version must be ≥1; got ${state.schema_version}`);
}
if (typeof state.sprint_id !== 'string') {
  emit('blocking', 'sprint_id_missing', 'sprint_id missing');
}

// last_commit_sha must match HEAD OR the working tree is clean and the
// commit is reachable.
const sha = state.last_commit_sha;
if (sha) {
  let head = '';
  try {
    head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim();
  } catch { /* not a repo or no HEAD */ }
  let dirty = true;
  try {
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: projectRoot, encoding: 'utf8' }).trim();
    dirty = status.length > 0;
  } catch { /* ignore */ }
  let reachable = false;
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { cwd: projectRoot, stdio: 'ignore' });
    reachable = true;
  } catch { reachable = false; }

  if (head !== sha && !(reachable && !dirty)) {
    emit('blocking', 'state_drifted_from_head', `last_commit_sha=${sha} but HEAD=${head}; reachable=${reachable}; dirty=${dirty}`, {
      last_commit_sha: sha,
      head,
      reachable,
      dirty,
    });
  }
}

// Per-task: in_progress with too many attempts.
const taskStatus = state.task_status ?? {};
const taskByIdAttempts = new Map();
// We don't have per-task max_attempts inline here — accept up to 5 attempts
// before flagging unless the sprint plan provides better numbers.
let maxAttempts = 5;
const sprintFile = join(projectRoot, '.planning/sprints', `${state.sprint_id}.tasks.json`);
if (existsSync(sprintFile)) {
  try {
    const tasks = JSON.parse(readFileSync(sprintFile, 'utf8')).tasks ?? [];
    for (const t of tasks) {
      if (t?.id && typeof t.max_attempts === 'number') taskByIdAttempts.set(t.id, t.max_attempts);
    }
  } catch { /* ignore */ }
}

for (const inflight of state.in_flight ?? []) {
  if (!inflight || typeof inflight.task_id !== 'string') continue;
  const cap = taskByIdAttempts.get(inflight.task_id) ?? maxAttempts;
  if (typeof inflight.attempt === 'number' && inflight.attempt > cap) {
    emit('blocking', 'task_attempts_exceeded', `task ${inflight.task_id} in_flight attempt=${inflight.attempt} > max_attempts=${cap}`, {
      task_id: inflight.task_id,
      attempt: inflight.attempt,
      max_attempts: cap,
    });
  }
}

// Every blocked task must have a diagnostic file.
const blocked = state.blocked_tasks ?? [];
for (const b of blocked) {
  if (!b || typeof b.task_id !== 'string') continue;
  const diag = b.diagnostic_path
    ? resolve(projectRoot, b.diagnostic_path)
    : join(projectRoot, '.planning/blocked', state.sprint_id ?? '', `${b.task_id}.md`);
  if (!existsSync(diag)) {
    emit('blocking', 'blocked_diagnostic_missing', `blocked task ${b.task_id} has no diagnostic at ${diag}`, {
      task_id: b.task_id,
      diagnostic_path: diag,
    });
  }
}

for (const e of errors) process.stderr.write(JSON.stringify(e) + '\n');
const fatal = errors.filter((e) => e.severity === 'blocking').length;
if (fatal > 0) {
  process.stderr.write(`validate-state: ${fatal} blocking error(s); ${errors.length - fatal} other\n`);
  process.exit(1);
}
process.exit(0);
