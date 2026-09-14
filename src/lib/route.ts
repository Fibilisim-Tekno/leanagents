import { z } from 'zod';

export const taskSchema = z.object({
  kind: z.enum(['docs', 'fix', 'feature', 'review', 'unknown']),
  scope: z.enum(['typescript', 'javascript', 'other', 'unknown']),
  risk: z.enum(['low', 'normal', 'sensitive', 'unknown']),
  behaviorChange: z.boolean(),
}).strict();

export type Task = z.infer<typeof taskSchema>;

/** Explicit task facts, not keyword guessing. This emits a plan, never spawns agents. */
export function routeTask(input: unknown) {
  const task = taskSchema.parse(input);
  const uncertain = task.kind === 'unknown' || task.scope === 'unknown' || task.risk === 'unknown';
  const sensitive = task.risk === 'sensitive';
  const simpleDocs = task.kind === 'docs' && task.risk === 'low' && !task.behaviorChange && !uncertain;
  const review = !simpleDocs;
  const supportedReview = task.scope === 'typescript';
  const extraReviewer = review && task.kind !== 'review' && supportedReview;
  return {
    schemaVersion: 'leanagents.route.v1',
    mode: 'plan-only',
    task,
    executor: task.kind === 'review' && supportedReview ? 'code-reviewer' : 'host',
    additionalAgents: extraReviewer ? ['code-reviewer'] : [],
    maxConcurrentAgents: 1,
    rules: ['read-repository-instructions', 'preserve-existing-behavior', 'verify-changed-behavior'],
    references: review && supportedReview ? ['typescript-defects'] : [],
    referencePolicy: 'on-demand',
    reasons: [
      uncertain ? 'Inspect repository and clarify unknown task facts before editing.' : 'Use the host for implementation; no separate planner or developer agent.',
      review ? 'Behavior change, review request or uncertainty requires review.' : 'Explicitly low-impact work needs no additional agent.',
    ],
    requiredChecks: [
      'Inspect the final diff.',
      ...(task.behaviorChange ? ['Run relevant regression tests; record failures and skipped checks.'] : []),
      ...(review && !supportedReview ? ['Host review required: no validated specialist for this scope.'] : []),
      ...(sensitive ? ['Security review required before completion; no validated security specialist is bundled.'] : []),
    ],
    unresolved: [
      ...(uncertain ? ['Task facts remain unknown.'] : []),
      ...(sensitive ? ['Security specialist workflow is not implemented.'] : []),
    ],
  };
}
