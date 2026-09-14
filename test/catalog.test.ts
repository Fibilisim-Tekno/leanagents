import { describe, expect, it } from 'vitest';
import { docsOfKind, loadSources, countErrors } from '../src/lib/sources.js';
import { computeContextBudget, computeInvocationLoad } from '../src/lib/context.js';
import { check } from '../src/commands/check.js';
import { loadConfig } from '../src/lib/config.js';

/**
 * Guards the shipped catalog rather than a fixture. If these fail, the product
 * regressed, not the tooling.
 */
describe('shipped catalog', () => {
  const { docs, issues } = loadSources();

  it('has no schema or cross-reference errors', () => {
    expect(countErrors(issues)).toBe(0);
  });

  it('passes the budget gate', () => {
    const result = check();
    expect(result.errorCount).toBe(0);
    expect(result.ok).toBe(true);
  });

  it('ships a code-reviewer agent', () => {
    const agents = docsOfKind(docs, 'agent');
    expect(agents.map((agent) => agent.name)).toContain('code-reviewer');
  });

  it('injects the security baseline into every agent', () => {
    // This is the invariant that copy-pasting a baseline into each file is
    // trying to achieve. Here it is enforced instead of repeated.
    for (const agent of docsOfKind(docs, 'agent')) {
      expect(agent.frontmatter.shared).toContain('untrusted-input');
    }
  });

  it('keeps every agent description well inside the per-session budget', () => {
    const { budgets } = loadConfig();
    const budget = computeContextBudget(docs);
    expect(budget.agentDescriptionTokens).toBeLessThanOrEqual(budgets.allAgentDescriptionTokens);
    // Startup cost is the number this project exists to hold down.
    expect(budget.startupTokens).toBeLessThanOrEqual(budgets.startupTokens);
  });

  it('does not repeat shared block text inside agent bodies', () => {
    const sharedBodies = docsOfKind(docs, 'shared').map((block) => ({
      name: block.name,
      // A distinctive sentence fragment from each block.
      probe: block.body.trim().split(/\r?\n/).filter(Boolean)[0]?.slice(0, 40) ?? '',
    }));

    for (const agent of docsOfKind(docs, 'agent')) {
      for (const { name, probe } of sharedBodies) {
        if (probe.length === 0) continue;
        expect(
          agent.body.includes(probe),
          `${agent.name} repeats text from shared block ${name} instead of referencing it`,
        ).toBe(false);
      }
    }
  });

  it('keeps deep language detail out of the agent body', () => {
    const reviewer = docsOfKind(docs, 'agent').find((agent) => agent.name === 'code-reviewer');
    expect(reviewer).toBeDefined();
    // Detail belongs in a reference file that loads on demand.
    expect(reviewer?.frontmatter.reference).toContain('typescript-defects');
    const invocation = computeInvocationLoad(docs, 'code-reviewer');
    const referenceDoc = docsOfKind(docs, 'reference').find(
      (doc) => doc.name === 'typescript-defects',
    );
    expect(referenceDoc).toBeDefined();
    // The on-demand file is allowed to be large precisely because invoking the
    // agent does not pay for it.
    expect(invocation.totalTokens).toBeLessThan(1300);
  });

  it('accounts for shared blocks in invocation cost', () => {
    const invocation = computeInvocationLoad(docs, 'code-reviewer');
    expect(invocation.sharedBlocks.length).toBeGreaterThanOrEqual(3);
    expect(invocation.sharedTokens).toBeGreaterThan(0);
    expect(invocation.totalTokens).toBe(invocation.bodyTokens + invocation.sharedTokens);
  });
});
