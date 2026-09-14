import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { setup } from '../src/lib/setup.js';
const roots: string[] = [];
const fixture = () => { const root = mkdtempSync(join(tmpdir(), 'lean-setup-')); roots.push(root); return root; };
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
it('preserves original Codex instructions and is idempotent', () => {
  const root = fixture(); writeFileSync(join(root, 'AGENTS.md'), 'Existing instructions');
  expect(setup('codex', root).changed).toHaveLength(3);
  expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toContain('Existing instructions');
  expect(setup('codex', root).changed).toHaveLength(0);
});
it('supports each target and a second editor in the same project', () => {
  const root = fixture();
  for (const target of ['codex', 'kiro', 'cursor', 'antigravity']) {
    expect(setup(target, root).changed.length).toBeGreaterThan(0);
    expect(setup(target, root).changed).toHaveLength(0);
  }
});
it('preflights conflicts without writing earlier files', () => {
  const root = fixture(); mkdirSync(join(root, '.leanagents/reviewers'), { recursive: true });
  writeFileSync(join(root, '.leanagents/reviewers/code-reviewer.md'), 'User custom reviewer');
  expect(() => setup('codex', root)).toThrow(/differs/);
  expect(existsSync(join(root, 'AGENTS.md'))).toBe(false);
});
it('previews without writes and refuses an overriding instruction file', () => {
  const root = fixture(); expect(setup('codex', root, true).changed).toHaveLength(3);
  expect(existsSync(join(root, 'AGENTS.md'))).toBe(false);
  writeFileSync(join(root, 'AGENTS.override.md'), 'Override');
  expect(() => setup('codex', root)).toThrow(/precedence/);
});
