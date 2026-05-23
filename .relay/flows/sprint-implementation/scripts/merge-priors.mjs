#!/usr/bin/env node

// merge-priors.mjs — folds a `priors-patch.json` into
// `.planning/estimation_priors.json` deterministically per §5.5/§11.2.
//
// Usage:
//   node scripts/merge-priors.mjs <priors-patch.json> [<priors.json>]
//
// Default <priors.json> is .planning/estimation_priors.json relative to the
// patch file's git root. Mutations are atomic (temp file + rename).

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const argv = process.argv.slice(2);
if (argv.length === 0) {
  process.stderr.write('usage: merge-priors.mjs <priors-patch.json> [<priors.json>]\n');
  process.exit(1);
}

const patchPath = resolve(argv[0]);
const projectRoot = (() => {
  try {
    return execSync('git rev-parse --show-toplevel', {
      cwd: dirname(patchPath),
      encoding: 'utf8',
    }).trim();
  } catch {
    return process.cwd();
  }
})();
const priorsPath = argv[1]
  ? resolve(argv[1])
  : join(projectRoot, '.planning/estimation_priors.json');

const patch = JSON.parse(readFileSync(patchPath, 'utf8'));

const empty = {
  version: 1,
  updated_at: new Date().toISOString(),
  skill_multipliers: {},
  model_multipliers: {},
  kind_multipliers: {},
  wave_invariant_hints: [],
  verification_failure_modes: [],
};
const priors = existsSync(priorsPath) ? JSON.parse(readFileSync(priorsPath, 'utf8')) : empty;

// running mean + Welford-style stddev. We track sum and sum-of-squares so
// the patch only has to provide delta_n and delta_ratio_sum (and optionally
// delta_ratio_sq_sum).
const mergeMultiplierBucket = (existing = {}, patchEntries = {}) => {
  const out = { ...existing };
  for (const [name, delta] of Object.entries(patchEntries)) {
    const cur = out[name] ?? { mean_ratio: 1.0, n: 0, stddev: 0, _sum: 0, _sumSq: 0 };
    const dn = delta.delta_n ?? 0;
    const ds = delta.delta_ratio_sum ?? 0;
    const dsq = delta.delta_ratio_sq_sum ?? (dn > 0 ? (ds / dn) * ds : 0);
    const newSum = (cur._sum ?? cur.mean_ratio * cur.n) + ds;
    const newSumSq =
      (cur._sumSq ?? cur.stddev ** 2 * cur.n + cur.mean_ratio * cur.mean_ratio * cur.n) + dsq;
    const newN = cur.n + dn;
    if (newN === 0) {
      out[name] = { mean_ratio: 1.0, n: 0, stddev: 0 };
      continue;
    }
    const newMean = newSum / newN;
    const variance = Math.max(0, newSumSq / newN - newMean * newMean);
    out[name] = {
      mean_ratio: round4(newMean),
      n: newN,
      stddev: round4(Math.sqrt(variance)),
      _sum: newSum,
      _sumSq: newSumSq,
    };
  }
  return out;
};

priors.skill_multipliers = mergeMultiplierBucket(priors.skill_multipliers, patch.skill_multipliers);
priors.model_multipliers = mergeMultiplierBucket(priors.model_multipliers, patch.model_multipliers);
priors.kind_multipliers = mergeMultiplierBucket(priors.kind_multipliers, patch.kind_multipliers);

// wave_invariant_hints: append patches; deduplicate by pattern.
const existingHints = new Map((priors.wave_invariant_hints ?? []).map((h) => [h.pattern, h]));
for (const add of patch.wave_invariant_hints_add ?? []) {
  if (!add?.pattern) continue;
  const cur = existingHints.get(add.pattern);
  if (cur) {
    cur.evidence_sprints = [
      ...new Set([...(cur.evidence_sprints ?? []), ...(add.evidence_sprints ?? [])]),
    ];
    if (add.advice && !cur.advice) cur.advice = add.advice;
    // Promote to enforced after 3 sprints' evidence per §11.3.
    if (!cur.enforced && (cur.evidence_sprints?.length ?? 0) >= 3) cur.enforced = true;
  } else {
    existingHints.set(add.pattern, {
      pattern: add.pattern,
      advice: add.advice ?? '',
      evidence_sprints: [...new Set(add.evidence_sprints ?? [])],
      enforced: (add.evidence_sprints?.length ?? 0) >= 3,
    });
  }
}
priors.wave_invariant_hints = [...existingHints.values()];

// verification_failure_modes: weighted average of flake_rate.
const existingModes = new Map((priors.verification_failure_modes ?? []).map((m) => [m.command, m]));
for (const [cmd, delta] of Object.entries(patch.verification_failure_modes ?? {})) {
  const cur = existingModes.get(cmd) ?? { command: cmd, flake_rate: 0, n: 0 };
  const dn = delta.delta_n ?? 0;
  const dFails = delta.delta_failures ?? 0;
  const newN = cur.n + dn;
  const newRate = newN === 0 ? 0 : (cur.flake_rate * cur.n + dFails) / newN;
  existingModes.set(cmd, { command: cmd, flake_rate: round4(newRate), n: newN });
}
priors.verification_failure_modes = [...existingModes.values()];

priors.updated_at = new Date().toISOString();
priors.version = (priors.version ?? 0) + 1;

// Strip private accumulator fields before writing.
for (const bucket of ['skill_multipliers', 'model_multipliers', 'kind_multipliers']) {
  for (const k of Object.keys(priors[bucket] ?? {})) {
    delete priors[bucket][k]._sum;
    delete priors[bucket][k]._sumSq;
  }
}

const tmp = priorsPath + '.tmp';
writeFileSync(tmp, JSON.stringify(priors, null, 2) + '\n');
renameSync(tmp, priorsPath);
process.stderr.write(`merge-priors: wrote ${priorsPath} (version=${priors.version})\n`);

function round4(x) {
  return Math.round(x * 10000) / 10000;
}
