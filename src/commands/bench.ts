import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import {
  countDefects,
  countDistractors,
  defaultBenchRoot,
  findFixture,
  loadFixtures,
  type Fixture,
} from '../lib/bench.js';
import { findPackageRoot } from '../lib/pkg.js';
import { formatIssues, formatNumber, formatTable, pluralize } from '../lib/report.js';
import { countErrors } from '../lib/sources.js';
import {
  SCORE_SCHEMA_VERSION,
  aggregateScores,
  scoreOutput,
  type AgentAggregate,
  type FixtureScore,
} from '../lib/score.js';

export function formatFixtureTable(fixtures: Fixture[]): string[] {
  if (fixtures.length === 0) return ['No fixtures found.'];

  return formatTable(
    ['fixture', 'language', 'defects', 'distractors', 'lines'],
    fixtures.map((fixture) => [
      fixture.id,
      fixture.language,
      fixture.clean ? 'clean' : String(fixture.defects.length),
      String(fixture.distractors.length),
      String(fixture.codeLineCount),
    ]),
    ['left', 'left', 'right', 'right', 'right'],
  );
}

export function formatFixtureDetail(fixture: Fixture): string[] {
  const lines: string[] = [`${fixture.id} (${fixture.language}) — ${fixture.file}`, fixture.summary];

  if (fixture.clean) {
    lines.push('');
    lines.push('Clean fixture. The expected result is zero findings.');
  } else {
    lines.push('');
    lines.push('Known defects');
    lines.push(
      ...formatTable(
        ['id', 'line', 'severity', 'summary'],
        fixture.defects.map((defect) => [
          defect.id,
          defect.lineOptional ? `~${defect.line}` : String(defect.line),
          defect.severity,
          defect.summary,
        ]),
        ['left', 'right', 'left', 'left'],
      ),
    );
  }

  if (fixture.distractors.length > 0) {
    lines.push('');
    lines.push('Planted distractors, reporting one counts as noise');
    lines.push(
      ...formatTable(
        ['id', 'why it is not a defect'],
        fixture.distractors.map((distractor) => [distractor.id, distractor.summary]),
      ),
    );
  }

  return lines;
}

export function registerBenchCommand(program: Command): void {
  const bench = program
    .command('bench')
    .description('benchmark agents against code with known, pre-recorded defects');

  registerBenchScoreCommands(bench);

  bench
    .command('list')
    .description('list benchmark fixtures and the defects each one contains')
    .option('-r, --root <dir>', 'benchmark fixtures directory')
    .option('-f, --fixture <id>', 'show the full detail of one fixture')
    .option('-l, --language <scope>', 'only fixtures for this language or framework')
    .option('--json', 'emit machine-readable JSON instead of text')
    .action(
      (options: { root?: string; fixture?: string; language?: string; json?: boolean }) => {
        const rootDir = options.root ?? defaultBenchRoot();
        const { fixtures, issues } = loadFixtures(rootDir);

        const selected = fixtures.filter((fixture) => {
          if (options.fixture && fixture.id !== options.fixture) return false;
          if (options.language && fixture.language !== options.language) return false;
          return true;
        });

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                rootDir,
                errorCount: countErrors(issues),
                issues,
                fixtures: selected.map((fixture) => ({
                  id: fixture.id,
                  language: fixture.language,
                  file: fixture.file,
                  path: fixture.relPath,
                  summary: fixture.summary,
                  clean: fixture.clean,
                  codeLineCount: fixture.codeLineCount,
                  defects: fixture.defects,
                  distractors: fixture.distractors,
                })),
              },
              null,
              2,
            ),
          );
        } else {
          for (const line of formatIssues(issues)) console.log(line);
          if (issues.length > 0) console.log('');

          if (options.fixture) {
            const fixture = selected[0];
            if (!fixture) {
              console.error(`leanagents: no fixture with id "${options.fixture}"`);
              process.exitCode = 1;
              return;
            }
            for (const line of formatFixtureDetail(fixture)) console.log(line);
          } else {
            for (const line of formatFixtureTable(selected)) console.log(line);
            console.log('');
            console.log(
              `${pluralize(selected.length, 'fixture')}, ${pluralize(
                countDefects(selected),
                'known defect',
              )}, ${pluralize(countDistractors(selected), 'planted distractor')}.`,
            );
          }
        }

        if (countErrors(issues) > 0) {
          process.exitCode = 1;
        }
      },
    );
}

export function defaultResultsDir(): string {
  return join(findPackageRoot(), 'bench', 'results');
}

/** Result filenames encode agent, fixture and run so repeats do not overwrite. */
export function resultFilename(score: FixtureScore): string {
  const safeAgent = score.agent.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
  return `${safeAgent}__${score.fixture}__run${score.run}.json`;
}

export function writeScore(score: FixtureScore, resultsDir: string): string {
  mkdirSync(resultsDir, { recursive: true });
  const path = join(resultsDir, resultFilename(score));
  writeFileSync(path, `${JSON.stringify(score, null, 2)}\n`, 'utf8');
  return path;
}

export function readScores(resultsDir: string): { scores: FixtureScore[]; skipped: string[] } {
  if (!existsSync(resultsDir)) return { scores: [], skipped: [] };

  const scores: FixtureScore[] = [];
  const skipped: string[] = [];

  for (const entry of readdirSync(resultsDir).sort()) {
    if (!entry.endsWith('.json')) continue;
    try {
      const parsed = JSON.parse(readFileSync(join(resultsDir, entry), 'utf8')) as FixtureScore;
      if (parsed.schemaVersion !== SCORE_SCHEMA_VERSION) {
        skipped.push(`${entry} (schema ${String(parsed.schemaVersion)})`);
        continue;
      }
      scores.push(parsed);
    } catch {
      skipped.push(`${entry} (unreadable)`);
    }
  }

  return { scores, skipped };
}

function formatRatio(value: number | null): string {
  return value === null ? '-' : `${Math.round(value * 1000) / 10}%`;
}

export function formatScoreDetail(score: FixtureScore): string[] {
  const lines: string[] = [
    `${score.agent} on ${score.fixture}${score.clean ? ' (clean fixture)' : ''}, run ${score.run}`,
  ];

  if (score.defects.length > 0) {
    lines.push('');
    lines.push(
      ...formatTable(
        ['defect', 'severity', 'keywords', 'line', 'found'],
        score.defects.map((outcome) => [
          outcome.id,
          outcome.severity,
          outcome.keywordMatch ? 'yes' : `no (${outcome.unmatchedGroups.length} group missing)`,
          outcome.lineMatch ? 'yes' : `no (expected ~${outcome.expectedLine})`,
          outcome.detected ? 'yes' : 'MISSED',
        ]),
      ),
    );
  }

  const flagged = score.distractors.filter((outcome) => outcome.flagged);
  if (flagged.length > 0) {
    lines.push('');
    lines.push('Noise: flagged planted non-defects');
    for (const outcome of flagged) lines.push(`  ${outcome.id}`);
  }

  lines.push('');
  const metrics = score.metrics;
  lines.push(
    `Detected ${metrics.detected}/${metrics.totalDefects}, false positives ${metrics.falsePositives}, output ${formatNumber(score.outputTokens)} tokens.`,
  );
  if (score.clean && metrics.reportedFindings > 0) {
    lines.push(
      `Reported ${pluralize(metrics.reportedFindings, 'finding')} on code that has none.`,
    );
  }
  lines.push(
    `recall ${formatRatio(metrics.recall)}, precision ${formatRatio(metrics.precision)}, f1 ${formatRatio(metrics.f1)}`,
  );

  return lines;
}

export function formatAggregateTable(aggregates: AgentAggregate[]): string[] {
  if (aggregates.length === 0) return ['No scored runs found.'];

  return formatTable(
    ['agent', 'runs', 'detected', 'missed', 'noise', 'clean-noise', 'recall', 'precision', 'f1', 'out tokens'],
    aggregates.map((aggregate) => [
      aggregate.agent,
      String(aggregate.runs),
      `${aggregate.detected}/${aggregate.totalDefects}`,
      String(aggregate.missed),
      String(aggregate.falsePositives),
      String(aggregate.findingsOnCleanFixtures),
      formatRatio(aggregate.recall),
      formatRatio(aggregate.precision),
      formatRatio(aggregate.f1),
      formatNumber(aggregate.meanOutputTokens),
    ]),
    [
      'left',
      'right',
      'right',
      'right',
      'right',
      'right',
      'right',
      'right',
      'right',
      'right',
    ],
  );
}

export const METHOD_NOTE = [
  'Method: each agent was run in its own harness, its output saved to a file, and',
  'that text graded against pre-recorded defects. A defect counts as found only',
  'when every keyword group is satisfied and a cited line falls within tolerance.',
  'Noise counts planted non-defects that were flagged. Scoring never calls a model.',
].join('\n');

export function registerBenchScoreCommands(bench: Command): void {
  bench
    .command('score')
    .description('grade a saved agent output against a fixture, with no API call')
    .requiredOption('-f, --fixture <id>', 'fixture the output was produced for')
    .requiredOption('-o, --output <file>', 'file containing the agent output')
    .requiredOption('-a, --agent <label>', 'label identifying the agent under test')
    .option('-n, --run <number>', 'run number, for repeating the same fixture', '1')
    .option('-r, --root <dir>', 'benchmark fixtures directory')
    .option('--results <dir>', 'directory to write the scored result into')
    .option('--no-save', 'print the score without writing a result file')
    .option('--json', 'emit machine-readable JSON instead of text')
    .action(
      (options: {
        fixture: string;
        output: string;
        agent: string;
        run: string;
        root?: string;
        results?: string;
        save?: boolean;
        json?: boolean;
      }) => {
        const { fixtures, issues } = loadFixtures(options.root ?? defaultBenchRoot());
        if (countErrors(issues) > 0) {
          for (const line of formatIssues(issues)) console.error(line);
          process.exitCode = 1;
          return;
        }

        const fixture = findFixture(fixtures, options.fixture);
        if (!fixture) {
          console.error(`leanagents: no fixture with id "${options.fixture}"`);
          process.exitCode = 1;
          return;
        }

        if (!existsSync(options.output)) {
          console.error(`leanagents: output file does not exist: ${options.output}`);
          process.exitCode = 1;
          return;
        }

        const run = Number(options.run);
        if (!Number.isInteger(run) || run < 1) {
          console.error('leanagents: --run must be a positive integer');
          process.exitCode = 1;
          return;
        }

        const output = readFileSync(options.output, 'utf8');
        const score = scoreOutput(fixture, output, { agent: options.agent, run });

        let writtenTo: string | undefined;
        if (options.save !== false) {
          writtenTo = writeScore(score, options.results ?? defaultResultsDir());
        }

        if (options.json) {
          console.log(JSON.stringify({ ...score, writtenTo: writtenTo ?? null }, null, 2));
        } else {
          for (const line of formatScoreDetail(score)) console.log(line);
          if (writtenTo) {
            console.log('');
            console.log(`Saved to ${writtenTo}`);
          }
        }
      },
    );

  bench
    .command('report')
    .description('aggregate scored runs and compare agents side by side')
    .option('--results <dir>', 'directory holding scored result files')
    .option('-l, --language <scope>', 'only runs for this language or framework')
    .option('--json', 'emit machine-readable JSON instead of text')
    .action((options: { results?: string; language?: string; json?: boolean }) => {
      const resultsDir = options.results ?? defaultResultsDir();
      const { scores, skipped } = readScores(resultsDir);

      const selected = options.language
        ? scores.filter((score) => score.language === options.language)
        : scores;

      const aggregates = aggregateScores(selected);

      if (options.json) {
        console.log(
          JSON.stringify(
            { resultsDir, skipped, runs: selected.length, aggregates, scores: selected },
            null,
            2,
          ),
        );
        return;
      }

      for (const entry of skipped) console.log(`skipped ${entry}`);
      if (skipped.length > 0) console.log('');

      for (const line of formatAggregateTable(aggregates)) console.log(line);

      if (selected.length > 0) {
        console.log('');
        console.log(
          `${pluralize(selected.length, 'scored run')} across ${pluralize(
            new Set(selected.map((score) => score.fixture)).size,
            'fixture',
          )}.`,
        );
        console.log('');
        console.log(METHOD_NOTE);
      }
    });
}
