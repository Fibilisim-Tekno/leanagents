import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sourceSnapshot } from '../src/lib/review.js';
import { applyFix } from '../src/lib/apply-fix.js';

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'lean-apply-')); roots.push(root);
  const run = join(root, 'run'); mkdirSync(run); mkdirSync(join(run, 'candidate')); mkdirSync(join(run, 'review'));
  const source = 'export const value = 1;'; const changed = 'export const value = 2;';
  const test = "import {test} from 'node:test'; import assert from 'node:assert/strict'; import {value} from './a.ts'; test('value', () => assert.equal(value, 2));";
  writeFileSync(join(root, 'a.ts'), source); writeFileSync(join(root, 'a.test.ts'), test);
  writeFileSync(join(run, 'candidate/a.ts'), changed); writeFileSync(join(run, 'candidate/a.test.ts'), test);
  const original = sourceSnapshot(root, ['a.ts', 'a.test.ts']);
  const json = (file: string, value: unknown) => writeFileSync(join(run, file), JSON.stringify(value));
  json('original.json', original); json('workflow.json', { status: 'candidate-verified' });
  json('spec.json', { task: {kind:'fix',scope:'typescript',risk:'normal',behaviorChange:true}, request:'Fix value', files:['a.ts','a.test.ts'], editable:['a.ts'], tests:['a.test.ts'] });
  json('proposal.json', { explanation:'Fix value', changes:[{ path:'a.ts', beforeSha256:original[0]!.sha256, content:changed }] });
  json('review/result.json', {status:'response-received',answer:'{"verdict":"approve","findings":[]}'});
  return { root, run, source, changed };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe('verified fix application', () => {
  it('applies only selected changes after rerunning tests', async () => {
    const { root, run, changed } = fixture();
    expect((await applyFix(root, run)).status).toBe('applied');
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe(changed);
    await expect(applyFix(root, run)).rejects.toThrow(/Original files changed/);
  });
  it('preserves edits made since the proposal', async () => {
    const { root, run } = fixture(); writeFileSync(join(root, 'a.ts'), 'user edit');
    await expect(applyFix(root, run)).rejects.toThrow(/Original files changed/);
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('user edit');
  });
  it('refuses changed candidates and unapproved runs', async () => {
    const { root, run, source } = fixture(); writeFileSync(join(run, 'candidate/a.ts'), 'tampered');
    await expect(applyFix(root, run)).rejects.toThrow(/Candidate changed/);
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe(source);
    writeFileSync(join(run, 'workflow.json'), '{"status":"checks-failed"}');
    await expect(applyFix(root, run)).rejects.toThrow(/no verified candidate/);
  });
});
