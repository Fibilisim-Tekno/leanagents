import { existsSync } from 'node:fs';
import type { Command } from 'commander';
import { formatNumber, formatTable, pluralize, type Alignment } from '../lib/report.js';
import { defaultSourcesRoot, loadSources } from '../lib/sources.js';
import {
  TOKENIZER_NOTE,
  compareTokens,
  measureDirectory,
  measurePath,
  type Comparison,
  type DirectoryMeasurement,
} from '../lib/tokens.js';
import {
  computeContextBudget,
  computeInvocationLoad,
  computeScopeLoad,
  scopesInUse,
  type ContextBudget,
  type InvocationLoad,
  type ScopeLoad,
} from '../lib/context.js';

const NUMERIC: Alignment[] = ['left', 'right', 'right', 'right'];

export interface CatalogMeasurement {
  rootDir: string;
  budget: ContextBudget;
  scopeLoads: ScopeLoad[];
  invocations: InvocationLoad[];
  files: DirectoryMeasurement;
}

export function measureCatalog(rootDir: string = defaultSourcesRoot()): CatalogMeasurement {
  const { docs } = loadSources(rootDir);
  const budget = computeContextBudget(docs);
  const scopeLoads = scopesInUse(docs).map((scope) => computeScopeLoad(docs, scope));
  const invocations = docs
    .filter((doc) => doc.kind === 'agent')
    .map((doc) => computeInvocationLoad(docs, doc.name))
    .sort((a, b) => b.totalTokens - a.totalTokens);

  return { rootDir, budget, scopeLoads, invocations, files: measureDirectory(rootDir) };
}

export function formatCatalogReport(measurement: CatalogMeasurement): string[] {
  const lines: string[] = [];
  const { budget, files } = measurement;

  lines.push(`Catalog: ${measurement.rootDir}`);
  lines.push(
    `${pluralize(files.totalFiles, 'file')}, ${formatNumber(files.totalTokens)} tokens on disk.`,
  );
  lines.push('');

  lines.push('Estimated startup under the catalog loading model (not observed usage)');
  lines.push(
    ...formatTable(
      ['what', 'count', 'tokens'],
      [
        ['agent descriptions', String(budget.agentCount), formatNumber(budget.agentDescriptionTokens)],
        [
          'alwaysApply rules',
          String(budget.alwaysApplyRuleCount),
          formatNumber(budget.alwaysApplyRuleTokens),
        ],
        ['startup total', '', formatNumber(budget.startupTokens)],
      ],
      ['left', 'right', 'right'],
    ),
  );
  lines.push('');

  lines.push('On-demand content under the loading model');
  lines.push(
    ...formatTable(
      ['what', 'tokens'],
      [
        ['all agent bodies', formatNumber(budget.allAgentBodyTokens)],
        ['all reference files', formatNumber(budget.allReferenceTokens)],
      ],
      ['left', 'right'],
    ),
  );

  if (measurement.scopeLoads.length > 0) {
    lines.push('');
    lines.push('Working on a file of each scope');
    lines.push(
      ...formatTable(
        ['scope', 'rules', 'rule tokens', 'total in context'],
        measurement.scopeLoads.map((load) => [
          load.scope,
          String(load.scopeRuleCount),
          formatNumber(load.scopeRuleTokens),
          formatNumber(load.totalTokens),
        ]),
        NUMERIC,
      ),
    );
  }

  if (measurement.invocations.length > 0) {
    lines.push('');
    lines.push('Estimated agent body plus shared text (excludes runtime overhead)');
    lines.push(
      ...formatTable(
        ['agent', 'body', 'shared', 'total'],
        measurement.invocations.map((invocation) => [
          invocation.agent,
          formatNumber(invocation.bodyTokens),
          formatNumber(invocation.sharedTokens),
          formatNumber(invocation.totalTokens),
        ]),
        NUMERIC,
      ),
    );
  }

  lines.push('');
  lines.push(TOKENIZER_NOTE);
  return lines;
}

export function formatDirectoryReport(measurement: DirectoryMeasurement): string[] {
  const lines: string[] = [];

  lines.push(`Directory: ${measurement.rootDir}`);
  lines.push(
    `${pluralize(measurement.totalFiles, 'markdown file')}, ${formatNumber(
      measurement.totalTokens,
    )} tokens, ${formatNumber(measurement.totalLines)} lines.`,
  );

  if (measurement.groups.length > 0) {
    lines.push('');
    lines.push(
      ...formatTable(
        ['group', 'files', 'tokens', 'lines'],
        measurement.groups.map((group) => [
          group.group,
          String(group.files),
          formatNumber(group.tokens),
          formatNumber(group.lines),
        ]),
        NUMERIC,
      ),
    );
  }

  const largest = [...measurement.files].sort((a, b) => b.tokens - a.tokens).slice(0, 10);
  if (largest.length > 0) {
    lines.push('');
    lines.push('Largest files');
    lines.push(
      ...formatTable(
        ['file', 'tokens', 'lines'],
        largest.map((file) => [file.relPath, formatNumber(file.tokens), formatNumber(file.lines)]),
        ['left', 'right', 'right'],
      ),
    );
  }

  lines.push('');
  lines.push(TOKENIZER_NOTE);
  return lines;
}

export function formatComparisonReport(comparison: Comparison): string[] {
  const lines: string[] = [];

  lines.push(
    ...formatTable(
      ['side', 'path', 'tokens'],
      [
        ['baseline', comparison.baselineLabel, formatNumber(comparison.baselineTokens)],
        ['candidate', comparison.candidateLabel, formatNumber(comparison.candidateTokens)],
      ],
      ['left', 'left', 'right'],
    ),
  );
  lines.push('');

  if (comparison.savedTokens > 0) {
    lines.push(
      `Candidate uses ${formatNumber(comparison.savedTokens)} fewer tokens: ${comparison.savedPercent}% less, ${comparison.ratio}x smaller.`,
    );
  } else if (comparison.savedTokens < 0) {
    lines.push(
      `Candidate uses ${formatNumber(Math.abs(comparison.savedTokens))} more tokens: ${Math.abs(
        comparison.savedPercent,
      )}% more.`,
    );
  } else {
    lines.push('Both sides use the same number of tokens.');
  }

  lines.push('');
  lines.push(TOKENIZER_NOTE);
  return lines;
}

interface MeasureOptions {
  sources?: string;
  dir?: string;
  compare?: string[];
  json?: boolean;
}

export function registerMeasureCommand(program: Command): void {
  program
    .command('measure')
    .description('measure token cost offline, with no API key and no network access')
    .option('-s, --sources <dir>', 'measure the leanagents source catalog')
    .option('-d, --dir <dir>', 'measure any directory or file of markdown, ignoring schema')
    .option(
      '--compare <baseline> <candidate...>',
      'compare two files or directories, baseline first',
    )
    .option('--json', 'emit machine-readable JSON instead of text')
    .action((options: MeasureOptions) => {
      if (options.compare) {
        const [baseline, candidate] = options.compare;
        if (!baseline || !candidate || options.compare.length !== 2) {
          console.error('leanagents: --compare needs exactly two paths');
          process.exitCode = 1;
          return;
        }

        const baselineMeasurement = measurePath(baseline);
        const candidateMeasurement = measurePath(candidate);
        const comparison = compareTokens(
          baseline,
          baselineMeasurement.tokens,
          candidate,
          candidateMeasurement.tokens,
        );

        if (options.json) {
          console.log(JSON.stringify({ comparison, tokenizerNote: TOKENIZER_NOTE }, null, 2));
        } else {
          for (const line of formatComparisonReport(comparison)) console.log(line);
        }
        return;
      }

      if (options.dir) {
        if (!existsSync(options.dir)) {
          console.error(`leanagents: path does not exist: ${options.dir}`);
          process.exitCode = 1;
          return;
        }

        const measurement = measureDirectory(options.dir);
        if (options.json) {
          console.log(JSON.stringify({ ...measurement, tokenizerNote: TOKENIZER_NOTE }, null, 2));
        } else {
          for (const line of formatDirectoryReport(measurement)) console.log(line);
        }
        return;
      }

      const rootDir = options.sources ?? defaultSourcesRoot();
      if (!existsSync(rootDir)) {
        console.error(`leanagents: sources directory does not exist: ${rootDir}`);
        process.exitCode = 1;
        return;
      }

      const measurement = measureCatalog(rootDir);
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              rootDir: measurement.rootDir,
              budget: measurement.budget,
              scopeLoads: measurement.scopeLoads,
              invocations: measurement.invocations,
              totals: {
                files: measurement.files.totalFiles,
                tokens: measurement.files.totalTokens,
                lines: measurement.files.totalLines,
              },
              tokenizerNote: TOKENIZER_NOTE,
            },
            null,
            2,
          ),
        );
      } else {
        for (const line of formatCatalogReport(measurement)) console.log(line);
      }
    });
}
