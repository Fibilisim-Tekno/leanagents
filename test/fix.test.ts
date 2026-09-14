import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseVerdict, runChecks, runFix, validateProposal } from '../src/lib/fix.js';
import { sourceSnapshot, runModelPrompt } from '../src/lib/review.js';

vi.mock('../src/lib/review.js', async (original) => ({
  ...await original<typeof import('../src/lib/review.js')>(), runModelPrompt: vi.fn(),
}));
const roots: string[] = [];
const model = vi.mocked(runModelPrompt);
const original = 'export const page = (items: number[], offset: number, limit: number) => items.slice(offset, limit);';
const fixed = original.replace('slice(offset, limit)', 'slice(offset, offset + limit)');
const spec = { task: { kind: 'fix', scope: 'typescript', risk: 'normal', behaviorChange: true },
  request: 'offset is start; limit is count. Fix pagination.',
  files: ['page.ts', 'page.test.ts'], editable: ['page.ts'], tests: ['page.test.ts'] };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'lean-fix-')); roots.push(root);
  writeFileSync(join(root, 'page.ts'), original);
  writeFileSync(join(root, 'page.test.ts'),
    "import {test} from 'node:test'; import assert from 'node:assert/strict'; import {page} from './page.ts'; test('count', () => assert.deepEqual(page([0,1,2,3,4],2,3),[2,3,4]));");
  return root;
}
function answer(text: string) {
  return { status: 'response-received', answer: text, usage: { input_tokens: 1, output_tokens: 1 },
    model: 'test', effort: 'low', durationMs: 1, mode: 'test', args: [], exitCode: 0,
    timedOut: false, malformed: false, toolEvents: 0, limitation: 'Test transport' };
}
function proposal(root: string, content = fixed) {
  const before = sourceSnapshot(root, ['page.ts'])[0]!;
  return JSON.stringify({ explanation: 'Use end index', changes: [{ path: before.path, beforeSha256: before.sha256, content }] });
}
afterEach(() => { model.mockReset(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('bounded fix workflow', () => {
  it('rejects unselected targets, stale source hashes, no-op patches and prose', () => {
    const root = fixture(); const sources = sourceSnapshot(root, spec.files);
    expect(() => validateProposal(proposal(root), sources, spec.editable)).not.toThrow();
    expect(() => validateProposal(proposal(root).replace('page.ts', '../outside.ts'), sources, spec.editable)).toThrow();
    expect(() => validateProposal(proposal(root).replace(sources[0]!.sha256, 'stale'), sources, spec.editable)).toThrow();
    expect(() => validateProposal(proposal(root, original), sources, spec.editable)).toThrow();
    expect(() => validateProposal('Here is JSON: ' + proposal(root), sources, spec.editable)).toThrow();
  });
  it('rejects conflicting reviewer approval', () => {
    expect(() => parseVerdict('{"verdict":"approve","findings":["bug"]}')).toThrow();
  });
  it('does not count all-skipped tests as validation', async () => {
    const root = fixture();
    writeFileSync(join(root, 'page.test.ts'), "import {test} from 'node:test'; test.skip('skipped', () => {});");
    expect((await runChecks(root, spec.tests)).ok).toBe(false);
  });
  it('fixes only the candidate and runs tests before a single reviewer', async () => {
    const root = fixture();
    model.mockResolvedValueOnce(answer(proposal(root))).mockResolvedValueOnce(answer('{"verdict":"approve","findings":[]}'));
    const result = await runFix({ root, spec, out: join(root, 'run'), executable: 'unused', model: 'test' });
    expect(result.status).toBe('candidate-verified');
    expect(result.baseline).toMatchObject({ ok: false });
    expect(result.checks).toMatchObject({ ok: true, passed: 1 });
    expect(readFileSync(join(root, 'page.ts'), 'utf8')).toBe(original);
    expect(readFileSync(join(root, 'run/candidate/page.ts'), 'utf8')).toBe(fixed);
    expect(model).toHaveBeenCalledTimes(2);
  });
  it('stops before review when the proposed fix still fails', async () => {
    const root = fixture(); model.mockResolvedValueOnce(answer(proposal(root, original + '\n')));
    const result = await runFix({ root, spec, out: join(root, 'run'), executable: 'unused', model: 'test' });
    expect(result.status).toBe('checks-failed');
    expect(model).toHaveBeenCalledTimes(1);
  });
  it('does not mark a rejected review as success', async () => {
    const root = fixture();
    model.mockResolvedValueOnce(answer(proposal(root))).mockResolvedValueOnce(answer('{"verdict":"insufficient-context","findings":["contract missing"]}'));
    const result = await runFix({ root, spec, out: join(root, 'run'), executable: 'unused', model: 'test' });
    expect(result.status).toBe('review-blocked');
  });
  it('rejects editable tests and unknown risk before model calls', async () => {
    const root = fixture();
    await expect(runFix({ root, spec: { ...spec, editable: spec.tests }, out: join(root, 'run'), executable: 'unused', model: 'test' })).rejects.toThrow(/Tests cannot/);
    await expect(runFix({ root, spec: { ...spec, task: { ...spec.task, risk: 'unknown' } }, out: join(root, 'run'), executable: 'unused', model: 'test' })).rejects.toThrow(/Unresolved/);
    expect(model).not.toHaveBeenCalled();
  });
  it('does not spend model calls when the test environment is missing an import', async () => {
    const root = fixture();
    writeFileSync(join(root, 'page.test.ts'), "import './missing.ts';");
    const result = await runFix({ root, spec, out: join(root, 'run'), executable: 'unused', model: 'test' });
    expect(result.status).toBe('baseline-unavailable');
    expect(model).not.toHaveBeenCalled();
  });
});
