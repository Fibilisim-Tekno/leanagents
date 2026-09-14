import type { Command } from 'commander';
import { evaluateBudgets, type BudgetReport } from '../lib/budget.js';
import { ConfigError, loadConfig, type Budgets } from '../lib/config.js';
import { formatIssues, formatNumber, formatTable, pluralize } from '../lib/report.js';
import {
  countErrors,
  countWarnings,
  defaultSourcesRoot,
  loadSources,
  type ValidationIssue,
} from '../lib/sources.js';

export interface CheckResult {
  rootDir: string;
  configPath?: string;
  budgets: Budgets;
  /** Schema and cross-reference problems. */
  schemaIssues: ValidationIssue[];
  /** Budget overruns. */
  budgetIssues: ValidationIssue[];
  report: BudgetReport;
  errorCount: number;
  warningCount: number;
  ok: boolean;
}

/**
 * The single gate CI runs: schema validity first, then budgets. Schema errors
 * are reported alongside budget errors rather than short-circuiting, so one run
 * shows every reason a change is being rejected.
 */
export function check(options: { sourcesDir?: string; configPath?: string } = {}): CheckResult {
  const rootDir = options.sourcesDir ?? defaultSourcesRoot();
  const { budgets, configPath } = loadConfig(options.configPath);
  const { docs, issues: schemaIssues } = loadSources(rootDir);
  const report = evaluateBudgets(docs, budgets);

  const allIssues = [...schemaIssues, ...report.issues];

  return {
    rootDir,
    ...(configPath ? { configPath } : {}),
    budgets,
    schemaIssues,
    budgetIssues: report.issues,
    report,
    errorCount: countErrors(allIssues),
    warningCount: countWarnings(allIssues),
    ok: countErrors(allIssues) === 0,
  };
}

/** Files closest to their ceiling, which is where the next regression lands. */
export function formatHeadroom(report: BudgetReport, limit = 10): string[] {
  if (report.docs.length === 0) return [];

  const rows = report.docs
    .slice(0, limit)
    .map((usage) => [
      usage.relPath,
      usage.kind,
      `${formatNumber(usage.tokens)}/${formatNumber(usage.tokenLimit)}`,
      `${usage.tokenPercent}%`,
      usage.lineLimit === undefined
        ? '-'
        : `${formatNumber(usage.lines)}/${formatNumber(usage.lineLimit)}`,
    ]);

  return [
    'Closest to their limits',
    ...formatTable(
      ['file', 'kind', 'tokens', 'used', 'lines'],
      rows,
      ['left', 'left', 'right', 'right', 'right'],
    ),
  ];
}

export function formatTotals(report: BudgetReport): string[] {
  return [
    'Catalog totals',
    ...formatTable(
      ['what', 'tokens', 'limit', 'used'],
      report.totals.map((total) => [
        total.label,
        formatNumber(total.value),
        formatNumber(total.limit),
        `${total.percent}%`,
      ]),
      ['left', 'right', 'right', 'right'],
    ),
  ];
}

export function formatCheckSummary(result: CheckResult): string[] {
  const lines: string[] = [];
  const docCount = result.report.docs.length;

  if (result.ok) {
    lines.push(
      `${pluralize(docCount, 'document')} within budget.` +
        (result.warningCount > 0 ? ` ${pluralize(result.warningCount, 'warning')}.` : ''),
    );
  } else {
    const parts = [pluralize(result.errorCount, 'error')];
    if (result.warningCount > 0) parts.push(pluralize(result.warningCount, 'warning'));
    lines.push(`${parts.join(', ')}. Budget check failed.`);
  }

  return lines;
}

export function registerCheckCommand(program: Command): void {
  program
    .command('check')
    .description('enforce schema validity and token budgets, the gate CI runs')
    .option('-s, --sources <dir>', 'sources directory to check')
    .option('-c, --config <file>', `config file to read budgets from`)
    .option('--json', 'emit machine-readable JSON instead of text')
    .option('--quiet', 'print only failures and the summary')
    .action((options: { sources?: string; config?: string; json?: boolean; quiet?: boolean }) => {
      let result: CheckResult;
      try {
        result = check({
          ...(options.sources ? { sourcesDir: options.sources } : {}),
          ...(options.config ? { configPath: options.config } : {}),
        });
      } catch (error) {
        if (error instanceof ConfigError) {
          console.error(`leanagents: ${error.message}`);
          process.exitCode = 1;
          return;
        }
        throw error;
      }

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              rootDir: result.rootDir,
              configPath: result.configPath ?? null,
              ok: result.ok,
              errorCount: result.errorCount,
              warningCount: result.warningCount,
              budgets: result.budgets,
              schemaIssues: result.schemaIssues,
              budgetIssues: result.budgetIssues,
              totals: result.report.totals,
              documents: result.report.docs,
            },
            null,
            2,
          ),
        );
      } else {
        const allIssues = [...result.schemaIssues, ...result.budgetIssues];
        const issueLines = formatIssues(allIssues);
        if (issueLines.length > 0) {
          for (const line of issueLines) console.log(line);
          console.log('');
        }

        if (!options.quiet) {
          for (const line of formatTotals(result.report)) console.log(line);
          const headroom = formatHeadroom(result.report);
          if (headroom.length > 0) {
            console.log('');
            for (const line of headroom) console.log(line);
          }
          console.log('');
        }

        for (const line of formatCheckSummary(result)) console.log(line);
      }

      if (!result.ok) {
        process.exitCode = 1;
      }
    });
}
