#!/usr/bin/env node
// Generates runtime-specific agent definitions from the canonical, model-agnostic
// role files in agents/roles/*.md, and mirrors .agents/skills → .claude/skills.
//
//   node scripts/sync-agents.mjs            # regenerate .claude/agents, .codex/agents, .claude/skills
//   node scripts/sync-agents.mjs --check    # exit 1 if generated files are stale (use in CI)
//
// Model/effort per tier come from ralph/models.env (same file the loop uses),
// so a single edit re-routes both runtimes.

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  existsSync,
  statSync,
} from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

// ---------- models.env ----------
const env = {};
for (const line of readFileSync(join(root, 'ralph/models.env'), 'utf8').split(
  '\n',
)) {
  const m = line.match(
    /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?\s*(#.*)?$/,
  );
  if (m) env[m[1]] = m[2].trim();
}
const tierCfg = (tier) => {
  const T = tier.toUpperCase();
  return {
    claudeModel: env[`CLAUDE_${T}_MODEL`] || 'inherit',
    claudeEffort: env[`CLAUDE_${T}_EFFORT`] || 'high',
    codexModel: env[`CODEX_${T}_MODEL`] || '',
    codexEffort: env[`CODEX_${T}_EFFORT`] || 'high',
  };
};

// ---------- portable tool vocabulary → runtime tools ----------
const claudeTools = {
  read: ['Read', 'Glob'],
  search: ['Grep', 'Glob'],
  write: ['Write'],
  edit: ['Edit'],
  shell: ['Bash'],
  web: ['WebFetch', 'WebSearch'],
};
const codexSandbox = (tools) =>
  tools.includes('write') || tools.includes('edit')
    ? 'workspace-write'
    : 'read-only';

// ---------- parse a role file ----------
function parseRole(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error('role file missing frontmatter');
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.startsWith('['))
      v = v
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    else if (kv[1] === 'tools')
      v = v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    fm[kv[1]] = v;
  }
  return { fm, body: m[2].trim() };
}

const outputs = new Map(); // path → content

const rolesDir = join(root, 'agents/roles');
for (const file of readdirSync(rolesDir).filter((f) => f.endsWith('.md'))) {
  const { fm, body } = parseRole(readFileSync(join(rolesDir, file), 'utf8'));
  const cfg = tierCfg(fm.tier || 'worker');
  const tools = fm.tools || ['read', 'search'];

  // ---- Claude Code: .claude/agents/<name>.md ----
  const ct = [
    ...new Set([...tools.flatMap((t) => claudeTools[t] || []), 'Skill']),
  ].join(', ');
  const claude = [
    '---',
    `name: ${fm.name}`,
    `description: ${fm.description}`,
    `tools: ${ct}`,
    `model: ${cfg.claudeModel}`,
    `effort: ${cfg.claudeEffort}`,
    ...(fm.skills?.length
      ? ['skills:', ...fm.skills.map((s) => `  - ${s}`)]
      : []),
    '---',
    '',
    `<!-- GENERATED from agents/roles/${file} by scripts/sync-agents.mjs — edit the role file, not this one. -->`,
    '',
    body,
    '',
    '## Runtime notes (Claude Code)',
    '',
    `Project skills listed above are preloaded. ${fm.plugin_skills?.length ? `For SDK mechanics use the official plugin skills: ${fm.plugin_skills.map((s) => '`/' + s + '`').join(', ')}.` : ''} Read \`AGENTS.md\` for build/test commands and the loop protocol.`,
    '',
  ].join('\n');
  outputs.set(join(root, '.claude/agents', `${fm.name}.md`), claude);

  // ---- Codex: .codex/agents/<name>.toml ----
  const instr = [
    body,
    '',
    '## Runtime notes (Codex)',
    '',
    `Project skills to apply: ${(fm.skills || []).map((s) => '$' + s).join(', ') || 'none'} (implicit invocation is on; you can also read \`.agents/skills/<name>/SKILL.md\` directly). ${fm.plugin_skills?.length ? `SDK mechanics: the even-realities/everything-evenhub plugin skills ${fm.plugin_skills.map((s) => '$' + s).join(', ')}.` : ''} Read \`AGENTS.md\` for build/test commands and the loop protocol. When finished, call report_agent_job_result with a short markdown summary.`,
  ].join('\n');
  const toml = [
    `# GENERATED from agents/roles/${file} by scripts/sync-agents.mjs — edit the role file, not this one.`,
    `name = ${JSON.stringify(fm.name)}`,
    `description = ${JSON.stringify(fm.description)}`,
    ...(cfg.codexModel ? [`model = ${JSON.stringify(cfg.codexModel)}`] : []),
    `model_reasoning_effort = ${JSON.stringify(cfg.codexEffort)}`,
    `sandbox_mode = ${JSON.stringify(codexSandbox(tools))}`,
    `developer_instructions = """`,
    instr.replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"'),
    `"""`,
    '',
  ].join('\n');
  outputs.set(join(root, '.codex/agents', `${fm.name}.toml`), toml);
}

// ---------- skills mirror: .agents/skills → .claude/skills (every file, incl. references/ and scripts/) ----------
const skillsSrc = join(root, '.agents/skills');
const walk = (dir, rel = '') =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory()
      ? walk(p, join(rel, name))
      : [join(rel, name)];
  });
for (const rel of walk(skillsSrc)) {
  outputs.set(
    join(root, '.claude/skills', rel),
    readFileSync(join(skillsSrc, rel), 'utf8'),
  );
}

// ---------- orphans: generated files whose source no longer exists ----------
const wanted = new Set(outputs.keys());
const orphanDirs = [
  join(root, '.claude/agents'),
  join(root, '.codex/agents'),
  join(root, '.claude/skills'),
];
// Only files this script generated are orphans. Agent files installed by plugins
// or by hand (no GENERATED marker) are left alone; the skills mirror is fully owned.
const generatedByUs = (p) =>
  p.includes('skills') ||
  readFileSync(p, 'utf8').includes('by scripts/sync-agents.mjs');
const orphans = orphanDirs
  .filter(existsSync)
  .flatMap((d) => walk(d).map((r) => join(d, r)))
  .filter((p) => !wanted.has(p) && generatedByUs(p));
for (const p of orphans) {
  if (check) {
    console.error(`orphan: ${p}`);
  } else {
    rmSync(p);
    console.log(`removed orphan ${relative(root, p)}`);
  }
}

// ---------- write or check ----------
let stale = 0;
for (const [path, content] of outputs) {
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (current === content) continue;
  stale++;
  if (check) console.error(`stale: ${path}`);
  else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    console.log(`wrote ${relative(root, path)}`);
  }
}
if (check) {
  const bad = stale + orphans.length;
  console.log(
    bad
      ? `${stale} stale + ${orphans.length} orphaned generated file(s) — run: node scripts/sync-agents.mjs`
      : 'generated agents/skills are up to date',
  );
  process.exit(bad ? 1 : 0);
}
console.log(`synced ${outputs.size} files`);
