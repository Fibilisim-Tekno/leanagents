import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { findFixture, loadFixtures, type Fixture } from '../src/lib/bench.js';
import {
  SCORE_SCHEMA_VERSION,
  aggregateScores,
  countSeverityTags,
  extractLineNumbers,
  scoreOutput,
  type FixtureScore,
} from '../src/lib/score.js';
import {
  formatAggregateTable,
  formatScoreDetail,
  readScores,
  resultFilename,
  writeScore,
} from '../src/commands/bench.js';

const here = dirname(fileURLToPath(import.meta.url));
const outputsDir = join(here, 'fixtures', 'outputs');
const { fixtures } = loadFixtures();
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'leanagents-score-'));
  tempDirs.push(dir);
  return dir;
}

function requireFixture(id: string): Fixture {
  const fixture = findFixture(fixtures, id);
  if (!fixture) throw new Error(`missing fixture ${id}`);
  return fixture;
}

function readOutput(name: string): string {
  return readFileSync(join(outputsDir, name), 'utf8');
}

const sqlFixture = requireFixture('sql-injection-user-lookup');
const cleanFixture = requireFixture('clean-pagination-helper');

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe('line extraction', () => {
  it('reads a file:line citation', () => {
    expect(extractLineNumbers('input.ts:25')).toContain(25);
  });

  it('reads a file:line:column citation', () => {
    expect(extractLineNumbers('src/app.tsx:40:12')).toContain(40);
  });

  it('reads prose line references', () => {
    expect(extractLineNumbers('the problem is at line 14 of the file')).toContain(14);
    expect(extractLineNumbers('see L88 for the guard')).toContain(88);
  });

  it('expands a line range', () => {
    const lines = extractLineNumbers('lines 40-43 build the query');
    expect(lines).toEqual(expect.arrayContaining([40, 41, 42, 43]));
  });

  it('ignores numbers that are not line references', () => {
    // Severity counts and years must not be read as lines.
    expect(extractLineNumbers('critical 1, high 0, medium 3 in 2026')).toEqual([]);
  });

  it('returns nothing for prose with no citation', () => {
    expect(extractLineNumbers('the database layer could be improved')).toEqual([]);
  });
});

describe('severity tag counting', () => {
  it('counts bracketed tags case-insensitively', () => {
    expect(countSeverityTags('[critical] a\n[HIGH] b\n[low] c')).toBe(3);
  });

  it('returns zero when no findings were reported', () => {
    expect(countSeverityTags('No findings.\napprove')).toBe(0);
  });
});

describe('scoring a defect', () => {
  it('credits a precise finding', () => {
    const score = scoreOutput(sqlFixture, readOutput('sql-perfect.txt'), { agent: 'precise' });
    const outcome = score.defects[0];

    expect(outcome?.keywordMatch).toBe(true);
    expect(outcome?.lineMatch).toBe(true);
    expect(outcome?.detected).toBe(true);
    expect(score.metrics.recall).toBe(1);
    expect(score.metrics.falsePositives).toBe(0);
    expect(score.metrics.precision).toBe(1);
    expect(score.metrics.f1).toBe(1);
  });

  it('does not credit vague prose with no mechanism named', () => {
    const score = scoreOutput(sqlFixture, readOutput('sql-vague.txt'), { agent: 'vague' });
    const outcome = score.defects[0];

    expect(outcome?.keywordMatch).toBe(false);
    expect(outcome?.detected).toBe(false);
    expect(outcome?.unmatchedGroups.length).toBeGreaterThan(0);
    expect(score.metrics.recall).toBe(0);
    expect(score.metrics.missed).toBe(1);
  });

  it('withholds credit when keywords match but the line is wrong', () => {
    const score = scoreOutput(sqlFixture, readOutput('sql-keywords-wrong-line.txt'), {
      agent: 'mislocated',
    });
    const outcome = score.defects[0];

    expect(outcome?.keywordMatch).toBe(true);
    expect(outcome?.lineMatch).toBe(false);
    expect(outcome?.detected).toBe(false);
  });

  it('counts a flagged distractor as noise and lowers precision', () => {
    const score = scoreOutput(sqlFixture, readOutput('sql-noisy.txt'), { agent: 'noisy' });

    expect(score.metrics.detected).toBe(1);
    expect(score.metrics.falsePositives).toBe(1);
    expect(score.metrics.recall).toBe(1);
    expect(score.metrics.precision).toBe(0.5);
    expect(score.metrics.f1).toBeLessThan(1);
    expect(score.distractors.find((d) => d.id === 'debug-console-log')?.flagged).toBe(true);
  });

  it('records the output size so verbosity is visible next to accuracy', () => {
    const precise = scoreOutput(sqlFixture, readOutput('sql-perfect.txt'), { agent: 'a' });
    const noisy = scoreOutput(sqlFixture, readOutput('sql-noisy.txt'), { agent: 'b' });
    expect(noisy.outputTokens).toBeGreaterThan(precise.outputTokens);
  });
});

describe('scoring a clean fixture', () => {
  it('treats a correct approve as no noise and no recall', () => {
    const score = scoreOutput(cleanFixture, readOutput('clean-approve.txt'), { agent: 'restrained' });

    expect(score.clean).toBe(true);
    expect(score.metrics.recall).toBeNull();
    expect(score.metrics.totalDefects).toBe(0);
    expect(score.metrics.falsePositives).toBe(0);
    expect(score.metrics.reportedFindings).toBe(0);
  });

  it('penalises invented findings on code that has none', () => {
    const score = scoreOutput(cleanFixture, readOutput('clean-invented.txt'), { agent: 'inventive' });

    expect(score.metrics.reportedFindings).toBe(3);
    expect(score.metrics.falsePositives).toBeGreaterThan(0);
    // Nothing was detected, so precision collapses.
    expect(score.metrics.precision).toBe(0);
  });

  it('shows the invented findings in the detail view', () => {
    const score = scoreOutput(cleanFixture, readOutput('clean-invented.txt'), { agent: 'inventive' });
    const detail = formatScoreDetail(score).join('\n');
    expect(detail).toContain('clean fixture');
    expect(detail).toContain('Noise');
    expect(detail).toContain('on code that has none');
  });
});

describe('aggregation across runs', () => {
  const scores: FixtureScore[] = [
    scoreOutput(sqlFixture, readOutput('sql-perfect.txt'), { agent: 'lean', run: 1 }),
    scoreOutput(sqlFixture, readOutput('sql-perfect.txt'), { agent: 'lean', run: 2 }),
    scoreOutput(cleanFixture, readOutput('clean-approve.txt'), { agent: 'lean', run: 1 }),
    scoreOutput(sqlFixture, readOutput('sql-noisy.txt'), { agent: 'other', run: 1 }),
    scoreOutput(cleanFixture, readOutput('clean-invented.txt'), { agent: 'other', run: 1 }),
  ];

  it('sums across runs and keeps the run count visible', () => {
    const aggregates = aggregateScores(scores);
    const lean = aggregates.find((a) => a.agent === 'lean');

    expect(lean?.runs).toBe(3);
    expect(lean?.fixtures).toBe(2);
    expect(lean?.detected).toBe(2);
    expect(lean?.totalDefects).toBe(2);
    expect(lean?.recall).toBe(1);
    expect(lean?.findingsOnCleanFixtures).toBe(0);
  });

  it('separates noise on clean fixtures from ordinary false positives', () => {
    const other = aggregateScores(scores).find((a) => a.agent === 'other');
    expect(other?.findingsOnCleanFixtures).toBe(3);
    expect(other?.falsePositives).toBeGreaterThan(0);
  });

  it('ranks the better agent first', () => {
    const aggregates = aggregateScores(scores);
    expect(aggregates[0]?.agent).toBe('lean');
  });

  it('renders a comparison table naming both agents', () => {
    const table = formatAggregateTable(aggregateScores(scores)).join('\n');
    expect(table).toContain('lean');
    expect(table).toContain('other');
    expect(table).toContain('clean-noise');
  });

  it('says so when there is nothing to report', () => {
    expect(formatAggregateTable([])).toEqual(['No scored runs found.']);
  });

  it('returns an empty aggregate for no scores', () => {
    expect(aggregateScores([])).toEqual([]);
  });
});

describe('result persistence', () => {
  it('encodes agent, fixture and run in the filename', () => {
    const score = scoreOutput(sqlFixture, readOutput('sql-perfect.txt'), {
      agent: 'LeanAgents Reviewer',
      run: 2,
    });
    expect(resultFilename(score)).toBe(
      'leanagents-reviewer__sql-injection-user-lookup__run2.json',
    );
  });

  it('round-trips a score through disk', () => {
    const dir = makeTempDir();
    const score = scoreOutput(sqlFixture, readOutput('sql-perfect.txt'), { agent: 'lean', run: 1 });
    writeScore(score, dir);

    const { scores, skipped } = readScores(dir);
    expect(skipped).toEqual([]);
    expect(scores).toHaveLength(1);
    expect(scores[0]?.schemaVersion).toBe(SCORE_SCHEMA_VERSION);
    expect(scores[0]?.metrics.detected).toBe(1);
  });

  it('does not overwrite a different run of the same fixture', () => {
    const dir = makeTempDir();
    writeScore(scoreOutput(sqlFixture, readOutput('sql-perfect.txt'), { agent: 'lean', run: 1 }), dir);
    writeScore(scoreOutput(sqlFixture, readOutput('sql-noisy.txt'), { agent: 'lean', run: 2 }), dir);

    expect(readScores(dir).scores).toHaveLength(2);
  });

  it('returns nothing for a results directory that does not exist', () => {
    expect(readScores(join(makeTempDir(), 'absent'))).toEqual({ scores: [], skipped: [] });
  });
});
