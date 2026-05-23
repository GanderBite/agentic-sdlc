#!/usr/bin/env node

// skill-linter.mjs — §19.3 skill linter.
//
// Usage:
//   node scripts/skill-linter.mjs
//
// Walks .claude/skills/* and validates against §19.3 rules.

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const errors = [];
const emit = (severity, code, message, extra = {}) =>
  errors.push({ severity, code, message, ...extra });

const projectRoot = (() => {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
})();

const skillsDir = join(projectRoot, '.claude/skills');
const indexPath = join(skillsDir, 'INDEX.json');

if (!existsSync(skillsDir)) {
  emit('blocking', 'skills_dir_missing', '.claude/skills directory missing');
  finish();
}
if (!existsSync(indexPath)) {
  emit('blocking', 'index_missing', '.claude/skills/INDEX.json missing');
  finish();
}

let index;
try {
  index = JSON.parse(readFileSync(indexPath, 'utf8'));
} catch (e) {
  emit('blocking', 'index_parse', `INDEX.json parse error: ${e.message}`);
  finish();
}

if (!Array.isArray(index.skills)) {
  emit('blocking', 'index_shape', 'INDEX.json must have a "skills" array');
  finish();
}

const indexNames = new Set();
for (const s of index.skills) {
  if (!s?.name || typeof s.name !== 'string') {
    emit('blocking', 'skill_name_missing', 'INDEX entry missing name');
    continue;
  }
  if (indexNames.has(s.name)) {
    emit('blocking', 'skill_name_duplicate_index', `INDEX has duplicate skill: ${s.name}`, {
      name: s.name,
    });
  }
  indexNames.add(s.name);
}

// Each on-disk skill exists in INDEX, and each INDEX skill exists on disk.
const onDisk = readdirSync(skillsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

for (const name of onDisk) {
  if (!indexNames.has(name)) {
    emit(
      'blocking',
      'skill_not_in_index',
      `.claude/skills/${name}/ exists on disk but is missing from INDEX.json`,
      { name },
    );
  }
}
for (const name of indexNames) {
  if (!onDisk.includes(name)) {
    emit(
      'blocking',
      'skill_not_on_disk',
      `INDEX.json lists "${name}" but .claude/skills/${name}/ does not exist`,
      { name },
    );
  }
}

// Per-skill checks.
const TOKEN_LIMIT = 5000;
const tokenCount = (text) => Math.ceil(text.length / 4); // matches §15.2 heuristic

const seenDomains = new Map();
for (const s of index.skills) {
  if (!s?.name || !indexNames.has(s.name)) continue;
  const dir = join(skillsDir, s.name);
  const skillMd = join(dir, 'SKILL.md');
  if (!existsSync(skillMd)) {
    emit('blocking', 'skill_md_missing', `${dir}/SKILL.md missing`, { name: s.name });
    continue;
  }
  const text = readFileSync(skillMd, 'utf8');
  const tokens = tokenCount(text);
  if (tokens > TOKEN_LIMIT) {
    emit(
      'blocking',
      'skill_md_oversize',
      `${s.name}/SKILL.md ≈ ${tokens} tokens > limit ${TOKEN_LIMIT}`,
      { name: s.name, tokens },
    );
  }
  if (/https?:\/\//i.test(text)) {
    emit(
      'blocking',
      'skill_md_url',
      `${s.name}/SKILL.md contains an http(s) URL — cache content locally`,
      { name: s.name },
    );
  }
  if (s.domain) {
    const key = `${s.domain}/${s.subdomain ?? ''}`;
    if (seenDomains.has(key)) {
      emit(
        'blocking',
        'skill_domain_duplicate',
        `${s.name} duplicates domain ${key} (also covered by ${seenDomains.get(key)})`,
        { name: s.name, domain: key },
      );
    } else {
      seenDomains.set(key, s.name);
    }
  }
  // references/ recommended for non-trivial skills (>3k tokens).
  if (tokens > 3000 && !existsSync(join(dir, 'references'))) {
    emit(
      'low',
      'skill_references_missing',
      `${s.name}/references/ missing — large SKILL.md should split into references`,
      { name: s.name, tokens },
    );
  }
}

finish();

function finish() {
  for (const e of errors) process.stderr.write(`${JSON.stringify(e)}\n`);
  const fatal = errors.filter((e) => e.severity === 'blocking').length;
  if (fatal > 0) {
    process.stderr.write(
      `skill-linter: ${fatal} blocking error(s); ${errors.length - fatal} other\n`,
    );
    process.exit(1);
  }
  process.exit(0);
}
