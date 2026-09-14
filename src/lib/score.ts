import type { Defect, Distractor, Fixture } from './bench.js';
import { countTextTokens } from './tokens.js';

/**
 * Scoring is deliberately offline. The agent runs in whatever harness the user
 * already pays for, its output is saved to a file, and this module grades that
 * text against the fixture's pre-recorded defects. No API key, no network, and
 * the same output always produces the same score.
 *
 * Known limitation, stated rather than hidden: this grades text, so a defect's
 * keywords can in principle be satisfied by a sentence written about a
 * different defect in the same review. Line matching narrows that, and both
 * signals are reported separately so a surprising score can be inspected
 * instead of trusted blindly.
 */
export const SCORE_SCHEMA_VERSION = 'leanagents.bench.v1';

export interface DefectOutcome {
  id: string;
  severity: Defect['severity'];
  /** Every keyword group had at least one term present. */
  keywordMatch: boolean;
  /** A cited line fell within the defect's tolerance. */
  lineMatch: boolean;
  /** Counted as found. Requires keywords, plus a line unless lineOptional. */
  detected: boolean;
  expectedLine: number;
  lineTolerance: number;
  /** Which keyword groups were satisfied, for diagnosing a near miss. */
  matchedGroups: number[];
  unmatchedGroups: number[];
}

export interface DistractorOutcome {
  id: string;
  /** The review flagged something that was planted as a non-defect. */
  flagged: boolean;
}

export interface ScoreMetrics {
  totalDefects: number;
  detected: number;
  missed: number;
  /** Distractors flagged. A proxy for noise, not a complete precision measure. */
  falsePositives: number;
  /** Severity tags counted in the output, used to spot findings on clean code. */
  reportedFindings: number;
  /** detected / totalDefects. Null when the fixture is clean. */
  recall: number | null;
  /** detected / (detected + falsePositives). Null when neither occurred. */
  precision: number | null;
  /** Harmonic mean of recall and precision. Null when either is null. */
  f1: number | null;
}

export interface FixtureScore {
  schemaVersion: typeof SCORE_SCHEMA_VERSION;
  agent: string;
  fixture: string;
  language: string;
  clean: boolean;
  run: number;
  recordedAt: string;
  outputTokens: number;
  defects: DefectOutcome[];
  distractors: DistractorOutcome[];
  metrics: ScoreMetrics;
}

/**
 * Pulls line citations out of review prose. Only patterns that clearly mean
 * "a line" are used, so a severity count or a year is not mistaken for one.
 */
export function extractLineNumbers(text: string): number[] {
  const found = new Set<number>();

  const patterns: RegExp[] = [
    // file.ts:42 or input.tsx:42:7
    /[\w./\\-]+\.[a-z]{2,4}:(\d{1,5})\b/gi,
    // line 42, lines 42, at line 42
    /\blines?\s+(\d{1,5})\b/gi,
    // L42
    /\bL(\d{1,5})\b/g,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = Number(match[1]);
      if (Number.isInteger(value) && value > 0) found.add(value);
    }
  }

  // Ranges such as "lines 40-44" contribute every line in between.
  for (const match of text.matchAll(/\blines?\s+(\d{1,5})\s*[-–—to]{1,3}\s*(\d{1,5})\b/gi)) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (Number.isInteger(start) && Number.isInteger(end) && end >= start && end - start <= 200) {
      for (let line = start; line <= end; line += 1) found.add(line);
    }
  }

  return [...found].sort((a, b) => a - b);
}

/** Counts bracketed severity tags, which the finding format requires. */
export function countSeverityTags(text: string): number {
  const matches = text.matchAll(/\[(critical|high|medium|low)\]/gi);
  return [...matches].length;
}

function normalise(text: string): string {
  return text.toLowerCase();
}

function groupSatisfied(haystack: string, group: string[]): boolean {
  return group.some((term) => haystack.includes(normalise(term)));
}

export function scoreDefect(defect: Defect, output: string, reportedLines: number[]): DefectOutcome {
  const haystack = normalise(output);

  const matchedGroups: number[] = [];
  const unmatchedGroups: number[] = [];
  defect.keywordGroups.forEach((group, index) => {
    if (groupSatisfied(haystack, group)) matchedGroups.push(index);
    else unmatchedGroups.push(index);
  });

  const keywordMatch = unmatchedGroups.length === 0;
  const lineMatch = reportedLines.some(
    (line) => Math.abs(line - defect.line) <= defect.lineTolerance,
  );

  return {
    id: defect.id,
    severity: defect.severity,
    keywordMatch,
    lineMatch,
    detected: keywordMatch && (lineMatch || defect.lineOptional),
    expectedLine: defect.line,
    lineTolerance: defect.lineTolerance,
    matchedGroups,
    unmatchedGroups,
  };
}

export function scoreDistractor(distractor: Distractor, output: string): DistractorOutcome {
  const haystack = normalise(output);
  return {
    id: distractor.id,
    flagged: distractor.keywordGroups.every((group) => groupSatisfied(haystack, group)),
  };
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 1000) / 1000;
}

export interface ScoreOptions {
  agent: string;
  run?: number;
  recordedAt?: string;
}

export function scoreOutput(
  fixture: Fixture,
  output: string,
  options: ScoreOptions,
): FixtureScore {
  const reportedLines = extractLineNumbers(output);

  const defects = fixture.defects.map((defect) => scoreDefect(defect, output, reportedLines));
  const distractors = fixture.distractors.map((distractor) =>
    scoreDistractor(distractor, output),
  );

  const detected = defects.filter((outcome) => outcome.detected).length;
  const falsePositives = distractors.filter((outcome) => outcome.flagged).length;
  const reportedFindings = countSeverityTags(output);

  const recall = fixture.clean ? null : ratio(detected, fixture.defects.length);
  const precision =
    detected + falsePositives === 0 ? null : ratio(detected, detected + falsePositives);
  const f1 =
    recall === null || precision === null || recall + precision === 0
      ? null
      : Math.round(((2 * recall * precision) / (recall + precision)) * 1000) / 1000;

  return {
    schemaVersion: SCORE_SCHEMA_VERSION,
    agent: options.agent,
    fixture: fixture.id,
    language: fixture.language,
    clean: fixture.clean,
    run: options.run ?? 1,
    recordedAt: options.recordedAt ?? new Date().toISOString(),
    outputTokens: countTextTokens(output),
    defects,
    distractors,
    metrics: {
      totalDefects: fixture.defects.length,
      detected,
      missed: fixture.defects.length - detected,
      falsePositives,
      reportedFindings,
      recall,
      precision,
      f1,
    },
  };
}

export interface AgentAggregate {
  agent: string;
  runs: number;
  fixtures: number;
  totalDefects: number;
  detected: number;
  missed: number;
  falsePositives: number;
  /** Findings reported on fixtures that contain no defects at all. */
  findingsOnCleanFixtures: number;
  meanOutputTokens: number;
  recall: number | null;
  precision: number | null;
  f1: number | null;
}

/**
 * Aggregates repeated runs. Model output is not deterministic, so a single run
 * is an anecdote; totals are summed across runs and reported with the run count
 * visible so nobody reads one run as a result.
 */
export function aggregateScores(scores: FixtureScore[]): AgentAggregate[] {
  const byAgent = new Map<string, FixtureScore[]>();
  for (const score of scores) {
    const bucket = byAgent.get(score.agent);
    if (bucket) bucket.push(score);
    else byAgent.set(score.agent, [score]);
  }

  const aggregates: AgentAggregate[] = [];

  for (const [agent, agentScores] of byAgent) {
    const totalDefects = agentScores.reduce((sum, s) => sum + s.metrics.totalDefects, 0);
    const detected = agentScores.reduce((sum, s) => sum + s.metrics.detected, 0);
    const falsePositives = agentScores.reduce((sum, s) => sum + s.metrics.falsePositives, 0);
    const findingsOnCleanFixtures = agentScores
      .filter((s) => s.clean)
      .reduce((sum, s) => sum + s.metrics.reportedFindings, 0);

    const recall = ratio(detected, totalDefects);
    const precision =
      detected + falsePositives === 0 ? null : ratio(detected, detected + falsePositives);
    const f1 =
      recall === null || precision === null || recall + precision === 0
        ? null
        : Math.round(((2 * recall * precision) / (recall + precision)) * 1000) / 1000;

    aggregates.push({
      agent,
      runs: agentScores.length,
      fixtures: new Set(agentScores.map((s) => s.fixture)).size,
      totalDefects,
      detected,
      missed: totalDefects - detected,
      falsePositives,
      findingsOnCleanFixtures,
      meanOutputTokens:
        agentScores.length === 0
          ? 0
          : Math.round(
              agentScores.reduce((sum, s) => sum + s.outputTokens, 0) / agentScores.length,
            ),
      recall,
      precision,
      f1,
    });
  }

  return aggregates.sort((a, b) => (b.f1 ?? -1) - (a.f1 ?? -1));
}
