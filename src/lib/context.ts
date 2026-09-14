import { countTextTokens } from './tokens.js';
import type { SourceDoc } from './sources.js';
import type { Scope } from './schema.js';

/**
 * Static loading model, not instrumentation of a live harness.
 * Assumes descriptions and alwaysApply rules at startup, scoped rules on
 * matching files, and bodies/references on demand. Target adapters must verify
 * those assumptions. Component sums exclude wrappers, repeated reads and usage.
 */
export interface ContextBudget {
  /** Tokens loaded on every session, no matter what the task is. */
  startupTokens: number;
  agentDescriptionTokens: number;
  alwaysApplyRuleTokens: number;
  agentCount: number;
  alwaysApplyRuleCount: number;
  /** Sum of every agent body. Not loaded at startup; shown for contrast. */
  allAgentBodyTokens: number;
  /** Sum of every reference file. Loaded on demand only. */
  allReferenceTokens: number;
}

export interface ScopeLoad {
  scope: Scope;
  /** Startup cost plus the rules that this scope pulls in. */
  totalTokens: number;
  scopeRuleTokens: number;
  scopeRuleCount: number;
}

export interface InvocationLoad {
  agent: string;
  /** Agent body plus the shared blocks injected into it at build time. */
  totalTokens: number;
  bodyTokens: number;
  sharedTokens: number;
  sharedBlocks: string[];
}

function bodyTokens(doc: SourceDoc): number {
  return countTextTokens(doc.body.trim());
}

function descriptionTokens(doc: SourceDoc): number {
  const description = doc.frontmatter.description;
  return typeof description === 'string' ? countTextTokens(description) : 0;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

export function computeContextBudget(docs: SourceDoc[]): ContextBudget {
  const agents = docs.filter((doc) => doc.kind === 'agent');
  const rules = docs.filter((doc) => doc.kind === 'rule');
  const references = docs.filter((doc) => doc.kind === 'reference');

  const alwaysApplyRules = rules.filter((rule) => rule.frontmatter.alwaysApply === true);

  const agentDescriptionTokens = agents.reduce((sum, doc) => sum + descriptionTokens(doc), 0);
  const alwaysApplyRuleTokens = alwaysApplyRules.reduce((sum, doc) => sum + bodyTokens(doc), 0);

  return {
    startupTokens: agentDescriptionTokens + alwaysApplyRuleTokens,
    agentDescriptionTokens,
    alwaysApplyRuleTokens,
    agentCount: agents.length,
    alwaysApplyRuleCount: alwaysApplyRules.length,
    allAgentBodyTokens: agents.reduce((sum, doc) => sum + bodyTokens(doc), 0),
    allReferenceTokens: references.reduce((sum, doc) => sum + bodyTokens(doc), 0),
  };
}

/**
 * What loads when the user is working on a file of the given scope.
 * alwaysApply rules are excluded here because they are already in startup.
 */
export function computeScopeLoad(docs: SourceDoc[], scope: Scope): ScopeLoad {
  const budget = computeContextBudget(docs);

  const scopeRules = docs.filter(
    (doc) =>
      doc.kind === 'rule' &&
      doc.frontmatter.scope === scope &&
      doc.frontmatter.alwaysApply !== true,
  );

  const scopeRuleTokens = scopeRules.reduce((sum, doc) => sum + bodyTokens(doc), 0);

  return {
    scope,
    totalTokens: budget.startupTokens + scopeRuleTokens,
    scopeRuleTokens,
    scopeRuleCount: scopeRules.length,
  };
}

/** Every scope that has at least one rule, so reports do not list empty scopes. */
export function scopesInUse(docs: SourceDoc[]): Scope[] {
  const scopes = new Set<Scope>();
  for (const doc of docs) {
    if (doc.kind !== 'rule') continue;
    if (doc.frontmatter.alwaysApply === true) continue;
    const scope = doc.frontmatter.scope;
    if (typeof scope === 'string') scopes.add(scope as Scope);
  }
  return [...scopes].sort();
}

export function computeInvocationLoad(docs: SourceDoc[], agentName: string): InvocationLoad {
  const agent = docs.find((doc) => doc.kind === 'agent' && doc.name === agentName);
  if (!agent) {
    throw new Error(`no agent named "${agentName}" in the source catalog`);
  }

  const sharedBlocks = stringArray(agent.frontmatter.shared);
  const sharedTokens = sharedBlocks.reduce((sum, name) => {
    const block = docs.find((doc) => doc.kind === 'shared' && doc.name === name);
    return sum + (block ? bodyTokens(block) : 0);
  }, 0);

  const bodyOnly = bodyTokens(agent);

  return {
    agent: agentName,
    totalTokens: bodyOnly + sharedTokens,
    bodyTokens: bodyOnly,
    sharedTokens,
    sharedBlocks,
  };
}
