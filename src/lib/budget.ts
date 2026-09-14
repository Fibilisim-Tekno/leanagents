import type { Budgets } from './config.js';
import { computeContextBudget } from './context.js';
import type { DocKind } from './schema.js';
import type { SourceDoc, ValidationIssue } from './sources.js';
import { countTextTokens } from './tokens.js';

/** Which token ceiling applies to each kind of document. */
const TOKEN_BUDGET_KEY: Record<DocKind, keyof Budgets> = {
  agent: 'agentBodyTokens',
  rule: 'ruleTokens',
  shared: 'sharedTokens',
  reference: 'referenceTokens',
};

/** Line ceilings only exist for the kinds a human reads top to bottom. */
const LINE_BUDGET_KEY: Partial<Record<DocKind, keyof Budgets>> = {
  agent: 'agentBodyLines',
  rule: 'ruleLines',
};

export interface DocUsage {
  name: string;
  kind: DocKind;
  relPath: string;
  tokens: number;
  tokenLimit: number;
  /** Percentage of the token ceiling used, rounded to one decimal. */
  tokenPercent: number;
  lines: number;
  lineLimit?: number;
  linePercent?: number;
  /** True when the file declares its own tighter maxTokens. */
  selfLimited: boolean;
}

export interface TotalUsage {
  label: string;
  value: number;
  limit: number;
  percent: number;
}

export interface BudgetReport {
  budgets: Budgets;
  issues: ValidationIssue[];
  docs: DocUsage[];
  totals: TotalUsage[];
  ok: boolean;
}

function percentOf(value: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.round((value / limit) * 1000) / 10;
}

function bodyTokensOf(doc: SourceDoc): number {
  return countTextTokens(doc.body.trim());
}

function declaredMaxTokens(doc: SourceDoc): number | undefined {
  const value = doc.frontmatter.maxTokens;
  return typeof value === 'number' ? value : undefined;
}

/**
 * Evaluates every document against the budgets and returns both the failures
 * and the usage table. Usage is returned even when nothing fails, because
 * knowing a file sits at 95% of its ceiling is what prevents the next
 * regression.
 */
export function evaluateBudgets(docs: SourceDoc[], budgets: Budgets): BudgetReport {
  const issues: ValidationIssue[] = [];
  const usages: DocUsage[] = [];

  for (const doc of docs) {
    const globalTokenLimit = budgets[TOKEN_BUDGET_KEY[doc.kind]];
    const declared = declaredMaxTokens(doc);

    // A per-file override may tighten a ceiling but never raise it, otherwise
    // the gate could be bypassed by editing the file it is meant to constrain.
    if (declared !== undefined && declared > globalTokenLimit) {
      issues.push({
        level: 'error',
        file: doc.relPath,
        message: `maxTokens ${declared} exceeds the ${doc.kind} ceiling of ${globalTokenLimit}; a file may lower its own limit, not raise it`,
      });
    }

    const tokenLimit =
      declared !== undefined && declared <= globalTokenLimit ? declared : globalTokenLimit;
    const tokens = bodyTokensOf(doc);

    if (tokens > tokenLimit) {
      issues.push({
        level: 'error',
        file: doc.relPath,
        message: `body is ${tokens} tokens, over the ${tokenLimit} token limit by ${tokens - tokenLimit}`,
      });
    }

    const lineBudgetKey = LINE_BUDGET_KEY[doc.kind];
    const lineLimit = lineBudgetKey ? budgets[lineBudgetKey] : undefined;
    if (lineLimit !== undefined && doc.bodyLineCount > lineLimit) {
      issues.push({
        level: 'error',
        file: doc.relPath,
        message: `body is ${doc.bodyLineCount} lines, over the ${lineLimit} line limit by ${doc.bodyLineCount - lineLimit}`,
      });
    }

    if (doc.kind === 'agent') {
      const description = doc.frontmatter.description;
      const descriptionTokens =
        typeof description === 'string' ? countTextTokens(description) : 0;
      if (descriptionTokens > budgets.agentDescriptionTokens) {
        issues.push({
          level: 'error',
          file: doc.relPath,
          message: `description is ${descriptionTokens} tokens, over the ${budgets.agentDescriptionTokens} token limit; descriptions load every session`,
        });
      }
    }

    usages.push({
      name: doc.name,
      kind: doc.kind,
      relPath: doc.relPath,
      tokens,
      tokenLimit,
      tokenPercent: percentOf(tokens, tokenLimit),
      lines: doc.bodyLineCount,
      ...(lineLimit !== undefined
        ? { lineLimit, linePercent: percentOf(doc.bodyLineCount, lineLimit) }
        : {}),
      selfLimited: declared !== undefined && declared <= globalTokenLimit,
    });
  }

  const contextBudget = computeContextBudget(docs);

  const totals: TotalUsage[] = [
    {
      label: 'all agent descriptions',
      value: contextBudget.agentDescriptionTokens,
      limit: budgets.allAgentDescriptionTokens,
      percent: percentOf(contextBudget.agentDescriptionTokens, budgets.allAgentDescriptionTokens),
    },
    {
      label: 'startup context',
      value: contextBudget.startupTokens,
      limit: budgets.startupTokens,
      percent: percentOf(contextBudget.startupTokens, budgets.startupTokens),
    },
  ];

  for (const total of totals) {
    if (total.value > total.limit) {
      issues.push({
        level: 'error',
        file: '(catalog)',
        message: `${total.label} total is ${total.value} tokens, over the ${total.limit} token limit by ${total.value - total.limit}`,
      });
    }
  }

  return {
    budgets,
    issues,
    docs: usages.sort((a, b) => b.tokenPercent - a.tokenPercent),
    totals,
    ok: issues.every((issue) => issue.level !== 'error'),
  };
}
