import { describe, expect, it } from 'vitest';
import { routeTask } from '../src/lib/route.js';

describe('task routing', () => {
  it('keeps an explicit documentation-only change on the host', () => {
    const plan = routeTask({ kind: 'docs', scope: 'typescript', risk: 'low', behaviorChange: false });
    expect(plan.additionalAgents).toEqual([]);
    expect(plan.references).toEqual([]);
  });
  it('does not let a docs label hide a behavior change', () => {
    expect(routeTask({ kind: 'docs', scope: 'typescript', risk: 'normal', behaviorChange: true }).additionalAgents)
      .toEqual(['code-reviewer']);
  });
  it('does not recursively ask a reviewer to spawn another reviewer', () => {
    const plan = routeTask({ kind: 'review', scope: 'typescript', risk: 'normal', behaviorChange: true });
    expect(plan.executor).toBe('code-reviewer');
    expect(plan.additionalAgents).toEqual([]);
  });
  it('does not claim a TypeScript specialist supports another language', () => {
    const plan = routeTask({ kind: 'fix', scope: 'other', risk: 'normal', behaviorChange: true });
    expect(plan.additionalAgents).toEqual([]);
    expect(plan.requiredChecks.join(' ')).toContain('Host review required');
  });
  it('retains a security requirement rather than inventing an available specialist', () => {
    const plan = routeTask({ kind: 'fix', scope: 'typescript', risk: 'sensitive', behaviorChange: true });
    expect(plan.unresolved).toContain('Security specialist workflow is not implemented.');
  });
  it('keeps unknown work unresolved instead of treating it as low risk', () => {
    expect(routeTask({ kind: 'unknown', scope: 'unknown', risk: 'unknown', behaviorChange: false }).unresolved)
      .toContain('Task facts remain unknown.');
  });
  it('rejects incomplete or malformed facts', () => {
    expect(() => routeTask({ kind: 'docs' })).toThrow();
    expect(() => routeTask({ kind: 'docs', scope: 'typescript', risk: 'low', behaviorChange: 'false' })).toThrow();
  });
});
