#!/usr/bin/env node
// validate-review.mjs — §10.4 reviewer output validator.
//
// Usage:
//   node scripts/validate-review.mjs <review-{wave}.json> [<findings-{wave}.json>]
//
// Checks both files in one shot. Mirrors §10.1 (review schema) and §10.2
// (findings schema). On failure, structured errors land on stderr (one
// JSON per line) and the script exits 1, triggering the reviewer's
// one-shot retry per §10.4.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const argv = process.argv.slice(2);
if (argv.length === 0) {
  process.stderr.write(
    'usage: validate-review.mjs <review-{wave}.json> [<findings-{wave}.json>]\n',
  );
  process.exit(1);
}

const errors = [];
const emit = (severity, code, message, extra = {}) =>
  errors.push({ severity, code, message, ...extra });

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    emit('blocking', 'parse_error', `cannot parse ${path}: ${e.message}`, { path });
    return null;
  }
};

const reviewPath = resolve(argv[0]);
const findingsPath = argv[1]
  ? resolve(argv[1])
  : reviewPath.replace(/(^|\/)review-/, '$1findings-');

const review = existsSync(reviewPath) ? readJson(reviewPath) : null;
const findings = existsSync(findingsPath) ? readJson(findingsPath) : null;

const projectRoot = (() => {
  let d = dirname(reviewPath);
  while (d !== dirname(d)) {
    if (existsSync(join(d, '.git'))) return d;
    d = dirname(d);
  }
  return process.cwd();
})();

// --- review-{wave}.json ----------------------------------------------------
if (!review) {
  emit('blocking', 'review_missing', `cannot read review file: ${reviewPath}`, {
    path: reviewPath,
  });
} else {
  if (typeof review.wave_id !== 'string' || !review.wave_id) {
    emit('blocking', 'review_wave_id_missing', 'review.wave_id must be a non-empty string');
  }
  if (!['pass', 'blocked', 'failed', 'partial', 'reviewer_overload'].includes(review.verdict)) {
    emit(
      'blocking',
      'review_verdict_invalid',
      `review.verdict invalid: ${JSON.stringify(review.verdict)}`,
    );
  }
  if (!Array.isArray(review.tasks)) {
    emit('blocking', 'review_tasks_invalid', 'review.tasks must be an array');
  } else {
    for (const t of review.tasks) {
      if (!t || typeof t.task_id !== 'string') {
        emit('blocking', 'review_task_missing_id', 'review.tasks[] entry missing task_id');
        continue;
      }
      if (!['pass', 'fail', 'partial'].includes(t.verdict)) {
        emit(
          'blocking',
          'review_task_verdict_invalid',
          `task ${t.task_id} verdict invalid: ${JSON.stringify(t.verdict)}`,
          { task_id: t.task_id },
        );
      }
      if (!Array.isArray(t.gates)) {
        emit('blocking', 'review_task_gates_invalid', `task ${t.task_id} gates must be an array`, {
          task_id: t.task_id,
        });
        continue;
      }
      for (const g of t.gates) {
        if (!g || typeof g !== 'object') continue;
        if (!['tests', 'lint', 'build', 'files_exist', 'custom'].includes(g.kind)) {
          emit(
            'high',
            'review_gate_kind_invalid',
            `task ${t.task_id} gate has invalid kind: ${g.kind}`,
            { task_id: t.task_id, kind: g.kind },
          );
        }
        if (typeof g.cmd !== 'string') {
          emit('high', 'review_gate_cmd_missing', `task ${t.task_id} gate missing cmd`, {
            task_id: t.task_id,
          });
        }
        if (typeof g.exit !== 'number') {
          emit('high', 'review_gate_exit_invalid', `task ${t.task_id} gate exit must be number`, {
            task_id: t.task_id,
          });
        }
      }
    }
  }
}

// --- findings-{wave}.json --------------------------------------------------
if (!findings) {
  emit('blocking', 'findings_missing', `cannot read findings file: ${findingsPath}`, {
    path: findingsPath,
  });
} else {
  if (!Array.isArray(findings.findings)) {
    emit('blocking', 'findings_array_invalid', 'findings.findings must be an array');
  } else {
    let blocking = 0;
    const seenIds = new Set();
    for (const f of findings.findings) {
      if (!f || typeof f !== 'object') {
        emit('blocking', 'finding_invalid_object', 'finding entry must be an object');
        continue;
      }
      if (typeof f.id !== 'string' || !/^F-\d+$/.test(f.id)) {
        emit(
          'high',
          'finding_id_format',
          `finding id should match /^F-\\d+$/, got ${JSON.stringify(f.id)}`,
        );
      } else if (seenIds.has(f.id)) {
        emit('blocking', 'finding_id_duplicate', `duplicate finding id: ${f.id}`, { id: f.id });
      } else {
        seenIds.add(f.id);
      }
      if (!['blocking', 'high', 'medium', 'low', 'info'].includes(f.severity)) {
        emit(
          'blocking',
          'finding_severity_invalid',
          `finding ${f.id ?? '?'} severity invalid: ${JSON.stringify(f.severity)}`,
          { id: f.id },
        );
      }
      if (
        !['security', 'architecture', 'performance', 'duplication', 'style'].includes(f.category)
      ) {
        emit(
          'high',
          'finding_category_invalid',
          `finding ${f.id ?? '?'} category invalid: ${JSON.stringify(f.category)}`,
          { id: f.id },
        );
      }
      if (typeof f.summary !== 'string' || !f.summary) {
        emit('high', 'finding_summary_missing', `finding ${f.id ?? '?'} summary missing`, {
          id: f.id,
        });
      }
      if (f.severity === 'blocking') blocking += 1;

      // Coordinate check: file path exists, line within bounds.
      if (typeof f.file === 'string' && f.file) {
        const abs = resolve(projectRoot, f.file);
        if (!existsSync(abs)) {
          emit(
            'blocking',
            'finding_file_missing',
            `finding ${f.id ?? '?'} references missing file: ${f.file}`,
            { id: f.id, file: f.file },
          );
        } else if (typeof f.line === 'number' && f.line > 0) {
          let lineCount = 0;
          try {
            lineCount = readFileSync(abs, 'utf8').split('\n').length;
          } catch {
            /* ignore */
          }
          if (lineCount > 0 && f.line > lineCount) {
            emit(
              'high',
              'finding_line_out_of_range',
              `finding ${f.id ?? '?'} line ${f.line} > file length ${lineCount}`,
              { id: f.id, file: f.file, line: f.line, file_lines: lineCount },
            );
          }
        }
      }
    }
    if (blocking > 5) {
      emit(
        'blocking',
        'findings_blocking_overload',
        `>${5} blocking findings (${blocking}) — reviewer panicking; fail the wave`,
        { blocking },
      );
    }
  }
}

for (const e of errors) process.stderr.write(`${JSON.stringify(e)}\n`);
const fatal = errors.filter((e) => e.severity === 'blocking').length;
if (fatal > 0) {
  process.stderr.write(
    `validate-review: ${fatal} blocking error(s); ${errors.length - fatal} other\n`,
  );
  process.exit(1);
}
process.exit(0);
