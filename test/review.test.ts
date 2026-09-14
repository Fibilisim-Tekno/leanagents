import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sourceSnapshot, summarizeReview, runSnapshotReview } from '../src/lib/review.js';

const events = [
  { type: 'item.started', item: { type: 'agent_message', text: 'partial' } },
  { type: 'item.completed', item: { type: 'agent_message', text: 'Review result' } },
  { type: 'turn.completed', usage: { input_tokens: 20, output_tokens: 5 } },
].map((e) => JSON.stringify(e)).join('\n');

describe('snapshot review evidence', () => {
  it('records only completed messages and actual usage', () => {
    const result = summarizeReview(events, 0, false);
    expect(result.status).toBe('response-received');
    expect(result.answer).toBe('Review result');
    expect(result.usage?.input_tokens).toBe(20);
  });
  it('does not treat process exit alone as review success', () => {
    for (const output of ['', 'null', 'invalid', events + '\nnull', events + '\n{"type":"turn.failed"}']) {
      expect(summarizeReview(output, 0, false).status).toBe('failed');
    }
    expect(summarizeReview(events, 1, false).status).toBe('failed');
    expect(summarizeReview(events, 0, true).status).toBe('failed');
    expect(summarizeReview(events + '\n{"type":"item.completed","item":{"type":"command_execution"}}', 0, false).status).toBe('failed');
  });
  it('rejects escapes, duplicates, non-source files and oversized snapshots', () => {
    const root = mkdtempSync(join(tmpdir(), 'lean-review-'));
    try {
      writeFileSync(join(root, 'a.ts'), 'export const a = 1;');
      writeFileSync(join(root, 'secret.txt'), 'secret');
      expect(sourceSnapshot(root, ['a.ts'])[0]?.path).toBe('a.ts');
      expect(() => sourceSnapshot(root, [])).toThrow();
      expect(() => sourceSnapshot(root, ['a.ts', './a.ts'])).toThrow(/Duplicate/);
      expect(() => sourceSnapshot(root, ['secret.txt'])).toThrow(/allowed/);
      expect(() => sourceSnapshot(root, ['..'])).toThrow(/outside/);
      writeFileSync(join(root, 'big.ts'), 'x'.repeat(96 * 1024 + 1));
      expect(() => sourceSnapshot(root, ['big.ts'])).toThrow(/exceeds/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('records a missing executable as failure without hanging', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lean-review-run-'));
    try {
      writeFileSync(join(root, 'a.ts'), 'export const a = 1;');
      const result = await runSnapshotReview({ root, files: ['a.ts'], request: 'Review.',
        out: join(root, 'result'), executable: join(root, 'missing'), model: 'test' });
      expect(result.status).toBe('failed');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('terminates a stalled runner and records a timeout', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lean-review-timeout-'));
    try {
      writeFileSync(join(root, 'a.ts'), 'export const a = 1;');
      writeFileSync(join(root, 'stall.cjs'), 'setInterval(() => {}, 1000);');
      const result = await runSnapshotReview({ root, files: ['a.ts'], request: 'Review.',
        out: join(root, 'result'), executable: process.execPath,
        prefixArgs: [join(root, 'stall.cjs')], model: 'test', timeoutMs: 250 });
      expect(result.status).toBe('failed');
      expect(result.timedOut).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
