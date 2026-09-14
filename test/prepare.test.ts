import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prepareTask, writeTaskPacket } from '../src/lib/prepare.js';
import { countTextTokens } from '../src/lib/tokens.js';

const task = { kind: 'fix', scope: 'typescript', risk: 'normal', behaviorChange: true };
describe('selected task packets', () => {
  it('keeps reference bodies out of the initial prompt and counts assembled text', () => {
    const packet = prepareTask(task, 'Fix the pagination regression.');
    const agent = packet.agents[0]!;
    expect(agent.references.length).toBeGreaterThan(0);
    expect(agent.prompt).not.toContain(agent.references[0]!.content);
    expect(agent.tokens).toBe(countTextTokens(agent.prompt));
    expect(agent.shared.length).toBe(new Set(agent.shared).size);
  });
  it('does not package reviewers for simple documentation', () => {
    expect(prepareTask({ ...task, kind: 'docs', risk: 'low', behaviorChange: false }, 'Fix typo.').agents).toEqual([]);
  });
  it('blocks unresolved risk and empty requests', () => {
    expect(() => prepareTask({ ...task, risk: 'unknown' }, 'Fix')).toThrow(/Unresolved/);
    expect(() => prepareTask(task, '  ')).toThrow(/empty/);
  });
  it('preserves existing output and records that no execution has occurred', () => {
    const root = mkdtempSync(join(tmpdir(), 'leanagents-packet-'));
    try {
      const out = join(root, 'task');
      const packet = prepareTask(task, 'Fix pagination.');
      writeTaskPacket(packet, out);
      const before = readFileSync(join(out, 'manifest.json'), 'utf8');
      expect(JSON.parse(before).executionStatus).toBe('not-run');
      expect(() => writeTaskPacket(packet, out)).toThrow();
      expect(readFileSync(join(out, 'manifest.json'), 'utf8')).toBe(before);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
