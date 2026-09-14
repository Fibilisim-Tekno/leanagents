import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';
import { describe, expect, it } from 'vitest';
import { renderAdapter, exportAdapter } from '../src/lib/adapters.js';

describe('editor bundles', () => {
  it('keeps reviewer and references out of bootstrap for every target', () => {
    for (const target of ['codex', 'kiro', 'cursor', 'antigravity']) {
      const bundle = renderAdapter(target);
      expect(bundle.files).toHaveLength(3);
      expect(bundle.bootstrapTokens).toBeLessThan(300);
      expect(bundle.files[0]!.content).not.toContain(bundle.files[1]!.content);
      expect(bundle.files[1]!.content).toContain('.leanagents/references/typescript-defects.md');
      expect(bundle.files[1]!.content).not.toContain(bundle.files[2]!.content);
    }
  });
  it('uses target-specific activation metadata', () => {
    expect(matter(renderAdapter('kiro').files[0]!.content).data).toEqual({ inclusion: 'always' });
    expect(matter(renderAdapter('cursor').files[0]!.content).data).toEqual({ alwaysApply: true });
    expect(matter(renderAdapter('antigravity').files[0]!.content).data).toEqual({ trigger: 'always_on' });
    expect(renderAdapter('antigravity').activation).toContain('Always On');
    expect(() => renderAdapter('../escape')).toThrow();
  });
  it('preserves existing bundles and exports all referenced files', () => {
    const root = mkdtempSync(join(tmpdir(), 'lean-export-'));
    try {
      const out = join(root, 'bundle');
      const manifest = exportAdapter('codex', out);
      const before = readFileSync(join(out, 'AGENTS.md'), 'utf8');
      expect(() => exportAdapter('cursor', out)).toThrow();
      expect(readFileSync(join(out, 'AGENTS.md'), 'utf8')).toBe(before);
      for (const file of manifest.files) expect(readFileSync(join(out, file.path), 'utf8').length).toBeGreaterThan(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
