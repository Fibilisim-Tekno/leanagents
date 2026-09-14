import type { Command } from 'commander';
import { formatIssues, pluralize } from '../lib/report.js';
import {
  countErrors,
  countWarnings,
  defaultSourcesRoot,
  loadSources,
  type SourceDoc,
  type ValidationIssue,
} from '../lib/sources.js';
import { DOC_KINDS, type DocKind } from '../lib/schema.js';

export interface ValidateResult {
  rootDir: string;
  docs: SourceDoc[];
  issues: ValidationIssue[];
  errorCount: number;
  warningCount: number;
  countsByKind: Record<DocKind, number>;
  ok: boolean;
}

export function validate(rootDir: string = defaultSourcesRoot()): ValidateResult {
  const { docs, issues } = loadSources(rootDir);
  const errorCount = countErrors(issues);
  const warningCount = countWarnings(issues);

  const countsByKind = Object.fromEntries(
    DOC_KINDS.map((kind) => [kind, docs.filter((doc) => doc.kind === kind).length]),
  ) as Record<DocKind, number>;

  return {
    rootDir,
    docs,
    issues,
    errorCount,
    warningCount,
    countsByKind,
    ok: errorCount === 0,
  };
}

export function formatValidateSummary(result: ValidateResult): string[] {
  const lines: string[] = [];
  const total = result.docs.length;

  const breakdown = DOC_KINDS.filter((kind) => result.countsByKind[kind] > 0)
    .map((kind) => `${result.countsByKind[kind]} ${kind}`)
    .join(', ');

  if (total === 0) {
    lines.push('No source documents found.');
  } else {
    lines.push(`Checked ${pluralize(total, 'document')}${breakdown ? ` (${breakdown})` : ''}.`);
  }

  if (result.errorCount === 0 && result.warningCount === 0) {
    lines.push('All source documents are valid.');
  } else {
    const parts: string[] = [];
    if (result.errorCount > 0) parts.push(pluralize(result.errorCount, 'error'));
    if (result.warningCount > 0) parts.push(pluralize(result.warningCount, 'warning'));
    lines.push(parts.join(', ') + '.');
  }

  return lines;
}

export function registerValidateCommand(program: Command): void {
  program
    .command('validate')
    .description('validate agent, rule, shared and reference source files')
    .option('-s, --sources <dir>', 'sources directory to validate')
    .option('--json', 'emit machine-readable JSON instead of text')
    .action((options: { sources?: string; json?: boolean }) => {
      const result = validate(options.sources ?? defaultSourcesRoot());

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              rootDir: result.rootDir,
              ok: result.ok,
              errorCount: result.errorCount,
              warningCount: result.warningCount,
              countsByKind: result.countsByKind,
              issues: result.issues,
              documents: result.docs.map((doc) => ({
                kind: doc.kind,
                name: doc.name,
                path: doc.relPath,
                bodyLineCount: doc.bodyLineCount,
              })),
            },
            null,
            2,
          ),
        );
      } else {
        for (const line of formatIssues(result.issues)) {
          console.log(line);
        }
        if (result.issues.length > 0) console.log('');
        for (const line of formatValidateSummary(result)) {
          console.log(line);
        }
      }

      if (!result.ok) {
        process.exitCode = 1;
      }
    });
}
