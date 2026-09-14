import { readFileSync, writeFileSync, renameSync, unlinkSync, statSync, realpathSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { fixSpecSchema, parseVerdict, runChecks, validateProposal } from './fix.js';
import { sourceSnapshot } from './review.js';

const originalSchema = z.array(z.object({ path: z.string(), content: z.string(), sha256: z.string() }).strict());
function atomicReplace(path: string, content: string) {
  const temp = join(dirname(path), `.leanagents-${randomUUID()}.tmp`);
  try {
    writeFileSync(temp, content, { flag: 'wx', mode: statSync(path).mode });
    renameSync(temp, path);
  } finally { if (existsSync(temp)) unlinkSync(temp); }
}

/** Explicit apply step; stop if either originals or tested candidates changed. */
export async function applyFix(root: string, run: string) {
  const base = realpathSync(root);
  const state = JSON.parse(readFileSync(join(run, 'workflow.json'), 'utf8')) as { status?: string };
  if (state.status !== 'candidate-verified') throw new Error('Run has no verified candidate');
  const spec = fixSpecSchema.parse(JSON.parse(readFileSync(join(run, 'spec.json'), 'utf8')));
  const original = originalSchema.parse(JSON.parse(readFileSync(join(run, 'original.json'), 'utf8')));
  const proposal = validateProposal(readFileSync(join(run, 'proposal.json'), 'utf8'), original, spec.editable);
  const verifyOriginal = () => {
    const current = sourceSnapshot(base, spec.files);
    if (current.length !== original.length || current.some((file, i) => file.path !== original[i]?.path
      || file.sha256 !== original[i]?.sha256 || file.content !== original[i]?.content)) {
      throw new Error('Original files changed since this run; refusing to overwrite them');
    }
  };
  verifyOriginal();
  const candidate = join(run, 'candidate');
  const verifyCandidate = () => {
    const files = sourceSnapshot(candidate, spec.files);
    if (files.length !== original.length || files.some((file, i) => {
      const change = proposal.changes.find((item) => item.path === file.path);
      return file.path !== original[i]?.path || file.content !== (change?.content ?? original[i]?.content);
    })) throw new Error('Candidate changed since review');
  };
  verifyCandidate();
  const result = JSON.parse(readFileSync(join(run, 'review/result.json'), 'utf8')) as { status?: string; answer?: string };
  if (result.status !== 'response-received' || typeof result.answer !== 'string' || parseVerdict(result.answer).verdict !== 'approve') {
    throw new Error('No approving review');
  }
  const checks = await runChecks(candidate, spec.tests);
  if (!checks.ok) throw new Error('Candidate checks no longer pass');
  verifyCandidate(); verifyOriginal();
  const written: Array<{ path: string; before: string; after: string }> = [];
  try {
    for (const change of proposal.changes) {
      const before = original.find((file) => file.path === change.path)!;
      const file = join(base, change.path);
      if (readFileSync(file, 'utf8') !== before.content) throw new Error('Concurrent edit detected');
      atomicReplace(file, change.content);
      written.push({ path: file, before: before.content, after: change.content });
    }
  } catch (error) {
    for (const item of written.reverse()) {
      // Do not roll back over a concurrent user edit.
      if (readFileSync(item.path, 'utf8') === item.after) atomicReplace(item.path, item.before);
    }
    throw error;
  }
  const receipt = { status: 'applied', files: proposal.changes.map((file) => file.path),
    validation: 'Candidate tests rerun; whole-repository tests not run.', checks };
  writeFileSync(join(run, 'applied.json'), JSON.stringify(receipt, null, 2));
  return receipt;
}
