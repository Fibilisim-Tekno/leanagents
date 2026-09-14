import { existsSync, lstatSync, readFileSync, realpathSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { renderAdapter } from './adapters.js';

const start = '<!-- leanagents:start -->';
const end = '<!-- leanagents:end -->';

export function setup(target: unknown, directory: string, dryRun = false) {
  const bundle = renderAdapter(target);
  const root = realpathSync(directory);
  const safe = (path: string) => {
    let current = root;
    for (const part of relative(root, path).split(/[\\/]/)) {
      current = join(current, part);
      if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error(`Refusing linked installation path: ${current}`);
    }
  };
  const changes = bundle.files.map((file) => {
    const path = join(root, file.path); safe(path);
    const before = existsSync(path) ? readFileSync(path, 'utf8') : null;
    let after = file.content;
    if (bundle.target === 'codex' && file.path === 'AGENTS.md') {
      const override = join(root, 'AGENTS.override.md'); safe(override);
      if (existsSync(override) && readFileSync(override, 'utf8').trim()) throw new Error('AGENTS.override.md takes precedence; integrate LeanAgents there manually. No files changed.');
      const block = `${start}\n${file.content}${end}`;
      if (before?.includes(start) || before?.includes(end)) {
        if (before.split(start).length !== 2 || before.split(end).length !== 2 || before.indexOf(end) < before.indexOf(start)) throw new Error('Invalid LeanAgents markers');
        const existing = before.slice(before.indexOf(start), before.indexOf(end) + end.length);
        if (existing !== block) throw new Error('Existing LeanAgents instructions differ; review them before upgrading');
        after = before;
      } else { after = `${before ?? ''}${before ? '\n\n' : ''}${block}\n`; }
    } else if (before !== null && before !== after) {
      throw new Error(`Existing file differs: ${file.path}. No files changed.`);
    }
    return { path, relative: file.path, before, after };
  });
  // Preflight every target before creating any files. Preserve original instructions.
  if (!dryRun) for (const change of changes) {
    if (change.before === change.after) continue;
    safe(change.path);
    const current = existsSync(change.path) ? readFileSync(change.path, 'utf8') : null;
    if (current !== change.before) throw new Error('Concurrent file change; setup stopped');
    mkdirSync(dirname(change.path), { recursive: true });
    if (change.before !== null) writeFileSync(`${change.path}.leanagents-backup-${Date.now()}`, change.before, { flag: 'wx' });
    writeFileSync(change.path, change.after, { flag: change.before === null ? 'wx' : 'w' });
  }
  return { target: bundle.target, dryRun, changed: changes.filter((c) => c.before !== c.after).map((c) => c.relative), activation: bundle.activation };
}
