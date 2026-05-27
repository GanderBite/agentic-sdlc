#!/usr/bin/env node
/**
 * derive-builders.mjs — deterministic replacement for the LLM-based
 * prompts/00_derive_builders.md step.
 *
 * Reads the sprint tasks and skills INDEX.json, clusters tasks by role
 * (frontend-builder, backend-builder, db-builder, infra-builder, tester),
 * and emits builder_agents JSON to stdout. Zero LLM tokens consumed.
 *
 * Env: $SPRINT_ID (required), $RELAY_HANDOFFS_DIR (optional — also writes
 *      the sidecar to .planning/state/<sprint>/builder_agents.json).
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SPRINT_ID = process.env.SPRINT_ID;
if (!SPRINT_ID) {
  console.error('[derive-builders] missing SPRINT_ID env');
  process.exit(1);
}

const root = process.cwd();
const tasksPath = join(root, `.planning/sprints/${SPRINT_ID}.tasks.json`);
const indexPath = join(root, '.claude/skills/INDEX.json');
const conventionsPath = join(root, '.planning/intel/conventions.md');
const archPath = join(root, 'docs/ARCHITECTURE.md');

let tasksData, indexData;
try {
  tasksData = JSON.parse(readFileSync(tasksPath, 'utf8'));
} catch {
  console.error(`[derive-builders] missing tasks file: ${tasksPath}`);
  process.exit(1);
}
try {
  indexData = JSON.parse(readFileSync(indexPath, 'utf8'));
} catch {
  console.error(`[derive-builders] missing skills INDEX: ${indexPath}`);
  process.exit(1);
}

const tasks = tasksData.tasks ?? [];
const validSkillNames = new Set((indexData.skills ?? []).map(s => s.name));
const skillIndex = Object.fromEntries((indexData.skills ?? []).map(s => [s.name, s]));

// Classify each skill into a role based on its domain/subdomain from INDEX.json.
const TESTING_SUFFIXES = ['-testing'];
const TESTING_DOMAINS = new Set(['testing']);
const FRONTEND_SUBDOMAINS = new Set(['react', 'routing', 'shadcn', 'data-fetching', 'styling', 'vite']);
const BACKEND_SUBDOMAINS = new Set(['hono', 'validation']);
const DB_SUBDOMAINS = new Set(['orm']);
const INFRA_SUBDOMAINS = new Set(['package-manager', 'linter-formatter', 'containers']);

function classifySkill(name) {
  if (TESTING_SUFFIXES.some(s => name.endsWith(s))) return 'tester';
  const info = skillIndex[name];
  if (!info) return null;
  if (TESTING_DOMAINS.has(info.domain)) return 'tester';
  if (FRONTEND_SUBDOMAINS.has(info.subdomain)) return 'frontend-builder';
  if (BACKEND_SUBDOMAINS.has(info.subdomain)) return 'backend-builder';
  if (DB_SUBDOMAINS.has(info.subdomain)) return 'db-builder';
  if (INFRA_SUBDOMAINS.has(info.subdomain)) return 'infra-builder';
  // Language/general skills go to all clusters that use them.
  return null;
}

// Cluster tasks by role.
// Rule: if ANY skill in task.skills is a *-testing skill, the task goes to tester.
// Otherwise, majority-vote by skill classification.
const clusters = {
  'frontend-builder': { tasks: [], skills: new Set() },
  'backend-builder':  { tasks: [], skills: new Set() },
  'db-builder':       { tasks: [], skills: new Set() },
  'infra-builder':    { tasks: [], skills: new Set() },
  'tester':           { tasks: [], skills: new Set() },
};

for (const task of tasks) {
  const taskSkills = (task.skills ?? []).filter(s => validSkillNames.has(s));
  if (taskSkills.length === 0) continue;

  // Testing override: if any skill ends with -testing or is in testing domain.
  const isTesting = taskSkills.some(s =>
    TESTING_SUFFIXES.some(suf => s.endsWith(suf)) ||
    (skillIndex[s] && TESTING_DOMAINS.has(skillIndex[s].domain))
  );

  if (isTesting && clusters.tester) {
    clusters.tester.tasks.push(task);
    taskSkills.forEach(s => clusters.tester.skills.add(s));
    continue;
  }

  // Classify by majority vote.
  const votes = {};
  for (const s of taskSkills) {
    const role = classifySkill(s);
    if (role && role !== 'tester') {
      votes[role] = (votes[role] ?? 0) + 1;
    }
  }

  // Pick the role with the most votes. Tie-break: frontend > backend > db > infra.
  const priority = ['frontend-builder', 'backend-builder', 'db-builder', 'infra-builder'];
  let bestRole = null;
  let bestCount = 0;
  for (const role of priority) {
    if ((votes[role] ?? 0) > bestCount) {
      bestCount = votes[role];
      bestRole = role;
    }
  }

  // Fallback: if no role matched, check if task has infra-like skills.
  if (!bestRole) {
    bestRole = priority.find(r => (votes[r] ?? 0) > 0) ?? 'backend-builder';
  }

  clusters[bestRole].tasks.push(task);
  taskSkills.forEach(s => clusters[bestRole].skills.add(s));
}

// Determine dominant model per cluster.
function dominantModel(clusterTasks) {
  const counts = {};
  for (const t of clusterTasks) {
    const m = t.model ?? 'sonnet';
    counts[m] = (counts[m] ?? 0) + 1;
  }
  let best = 'sonnet';
  let bestN = 0;
  for (const [m, n] of Object.entries(counts)) {
    if (n > bestN) { bestN = n; best = m; }
  }
  // Never use haiku for a builder with >1 task.
  if (best === 'haiku' && clusterTasks.length > 1) return 'sonnet';
  return best;
}

const BUILDER_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Skill'];

const SYSTEM_PROMPTS = {
  'frontend-builder': 'You are a frontend builder. You implement UI components under apps/ui/src/ (see ARCHITECTURE.md), wire them with TanStack Router and Query, and style per the Shadcn/Tailwind design system. You respect the boundary between frontend and backend modules.',
  'backend-builder': 'You are a backend builder. You implement HTTP routes under apps/api/src/ (see ARCHITECTURE.md), validate every request boundary with Zod schemas from @medbridge/contracts, persist via Drizzle, and write inline unit tests when your skill protocol requires. You never import frontend modules.',
  'db-builder': 'You are a database builder. You implement Drizzle schema definitions, migrations, and data access layers under apps/api/src/db/. You respect migration ordering and ensure schema changes are backwards-compatible within a sprint.',
  'infra-builder': 'You are an infrastructure builder. You handle build tooling, workspace config, Dockerfiles, docker-compose, CI scaffolding, and linter/formatter setup. You never implement application business logic.',
  'tester': 'You are a tester. You author dedicated test suites: integration tests against real infrastructure, frontend tests, security smokes (authn bypass, CSRF/XSS), and reusable test fixtures. You assert observable behavior, not implementation details. You DO NOT implement production code — if a test reveals a missing route, mark the task partial and escalate.',
};

const DESCRIPTIONS = {
  'frontend-builder': 'Implements UI components, routes, and styling.',
  'backend-builder': 'Implements server HTTP routes, validation, and services.',
  'db-builder': 'Implements ORM schema, migrations, and data access.',
  'infra-builder': 'Implements build tooling, workspace config, and containerization.',
  'tester': 'Authors dedicated test suites: unit, integration, e2e, and security.',
};

// Build output: one persona per non-empty cluster, capped at 5.
const personas = [];
for (const [name, cluster] of Object.entries(clusters)) {
  if (cluster.tasks.length === 0) continue;

  // Cap skills at 8.
  const skills = [...cluster.skills].slice(0, 8);

  personas.push({
    name,
    description: DESCRIPTIONS[name] ?? `Builds ${name} components.`,
    model: dominantModel(cluster.tasks),
    tools: BUILDER_TOOLS,
    skills,
    systemPrompt: SYSTEM_PROMPTS[name] ?? `You are a ${name}. Follow ARCHITECTURE.md conventions.`,
  });
}

// Cap at 5 personas.
const output = personas.slice(0, 5);

const outputJson = JSON.stringify(output, null, 2) + '\n';

// Write the sidecar file the wave-runner reads from disk.
const stateDir = join(root, `.planning/state/${SPRINT_ID}`);
try {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, 'builder_agents.json'), outputJson);
} catch (e) {
  console.error(`[derive-builders] warning: could not write sidecar: ${e.message}`);
}

// Write to the relay handoff directory so downstream steps can resolve
// `agents: { from: 'handoff.builder_agents' }` via the handoff store.
const handoffsDir = process.env.RELAY_HANDOFFS_DIR;
if (handoffsDir) {
  try {
    mkdirSync(handoffsDir, { recursive: true });
    writeFileSync(join(handoffsDir, 'builder_agents.json'), outputJson);
    console.error(`[derive-builders] wrote builder_agents.json to handoff store (${output.length} persona(s))`);
  } catch (e) {
    console.error(`[derive-builders] warning: could not write handoff: ${e.message}`);
  }
} else {
  console.error('[derive-builders] warning: RELAY_HANDOFFS_DIR not set — handoff not written');
}

// Emit to stdout for the artifact.
process.stdout.write(outputJson);
