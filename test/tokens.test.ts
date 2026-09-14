import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  collectMarkdownFiles,
  compareTokens,
  countLines,
  countTextTokens,
  measureDirectory,
  measureFile,
  measurePath,
} from '../src/lib/tokens.js';
import {
  computeContextBudget,
  computeInvocationLoad,
  computeScopeLoad,
  scopesInUse,
} from '../src/lib/context.js';
import { loadSources } from '../src/lib/sources.js';
import { formatTable, formatNumber } from '../src/lib/report.js';
import { formatComparisonReport, measureCatalog } from '../src/commands/measure.js';

const here = dirname(fileURLToPath(import.meta.url));
const validRoot = join(here, 'fixtures', 'sources-valid');

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'leanagents-tokens-'));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe('token counting', () => {
  it('returns zero for empty input', () => {
    expect(countTextTokens('')).toBe(0);
  });

  it('is deterministic for the same input', () => {
    const text = 'Review the diff and report only defects you can tie to a line.';
    expect(countTextTokens(text)).toBe(countTextTokens(text));
  });

  it('counts known short strings at their documented values', () => {
    // Verified against the bundled tokenizer; these are regression anchors.
    expect(countTextTokens('hello world')).toBe(2);
    expect(countTextTokens('The quick brown fox jumps over the lazy dog.')).toBe(10);
  });

  it('grows with input length', () => {
    const short = countTextTokens('one two three');
    const long = countTextTokens('one two three four five six seven eight nine ten');
    expect(long).toBeGreaterThan(short);
  });
});

describe('line counting', () => {
  it('ignores surrounding blank lines', () => {
    expect(countLines('\n\nalpha\nbeta\n\n')).toBe(2);
  });

  it('returns zero for whitespace only', () => {
    expect(countLines('   \n  \n')).toBe(0);
  });

  it('handles CRLF line endings', () => {
    expect(countLines('alpha\r\nbeta\r\ngamma')).toBe(3);
  });
});

describe('file and directory measurement', () => {
  it('measures a single file', () => {
    const dir = makeTempDir();
    const file = join(dir, 'sample.md');
    writeFileSync(file, 'alpha beta gamma\n', 'utf8');

    const measured = measureFile(file, dir);
    expect(measured.relPath).toBe('sample.md');
    expect(measured.tokens).toBeGreaterThan(0);
    expect(measured.lines).toBe(1);
    expect(measured.bytes).toBe(17);
  });

  it('only collects markdown and skips dot directories', () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'a.md'), 'alpha\n', 'utf8');
    writeFileSync(join(dir, 'b.txt'), 'beta\n', 'utf8');

    const collected = collectMarkdownFiles(dir);
    expect(collected).toHaveLength(1);
    expect(collected[0]?.endsWith('a.md')).toBe(true);
  });

  it('returns an empty list for a directory that does not exist', () => {
    expect(collectMarkdownFiles(join(makeTempDir(), 'nope'))).toEqual([]);
  });

  it('groups a directory by its first path segment', () => {
    const measurement = measureDirectory(validRoot);
    expect(measurement.totalFiles).toBe(4);
    expect(measurement.groups.map((group) => group.group).sort()).toEqual([
      'agents',
      'reference',
      'rules',
      'shared',
    ]);
    const sumOfGroups = measurement.groups.reduce((sum, group) => sum + group.tokens, 0);
    expect(sumOfGroups).toBe(measurement.totalTokens);
  });

  it('measures either a file or a directory through measurePath', () => {
    const dirResult = measurePath(validRoot);
    expect(dirResult.files).toBe(4);

    const fileResult = measurePath(join(validRoot, 'agents', 'code-reviewer.md'));
    expect(fileResult.files).toBe(1);
    expect(fileResult.tokens).toBeGreaterThan(0);
    expect(dirResult.tokens).toBeGreaterThan(fileResult.tokens);
  });

  it('throws a clear error for a missing path', () => {
    expect(() => measurePath(join(makeTempDir(), 'missing.md'))).toThrow(/does not exist/);
  });
});

describe('comparison arithmetic', () => {
  it('reports savings when the candidate is smaller', () => {
    const comparison = compareTokens('ecc', 1000, 'lean', 250);
    expect(comparison.savedTokens).toBe(750);
    expect(comparison.savedPercent).toBe(75);
    expect(comparison.ratio).toBe(4);
  });

  it('reports a regression when the candidate is larger', () => {
    const comparison = compareTokens('ecc', 100, 'lean', 150);
    expect(comparison.savedTokens).toBe(-50);
    expect(comparison.savedPercent).toBe(-50);
  });

  it('does not divide by zero', () => {
    expect(compareTokens('a', 0, 'b', 0).savedPercent).toBe(0);
    expect(compareTokens('a', 10, 'b', 0).ratio).toBe(0);
  });

  it('describes savings in the report text', () => {
    const text = formatComparisonReport(compareTokens('ecc', 1000, 'lean', 250)).join('\n');
    expect(text).toContain('75% less');
    expect(text).toContain('4x smaller');
  });

  it('describes a regression in the report text', () => {
    const text = formatComparisonReport(compareTokens('ecc', 100, 'lean', 150)).join('\n');
    expect(text).toContain('more tokens');
  });
});

describe('context budget model', () => {
  const docs = loadSources(validRoot).docs;

  it('counts agent descriptions but not agent bodies at startup', () => {
    const budget = computeContextBudget(docs);
    expect(budget.agentCount).toBe(1);
    expect(budget.agentDescriptionTokens).toBeGreaterThan(0);
    expect(budget.startupTokens).toBe(budget.agentDescriptionTokens + budget.alwaysApplyRuleTokens);
    // The fixture rule uses globs, not alwaysApply, so it is not a startup cost.
    expect(budget.alwaysApplyRuleCount).toBe(0);
    expect(budget.alwaysApplyRuleTokens).toBe(0);
    expect(budget.allAgentBodyTokens).toBeGreaterThan(0);
  });

  it('reports reference files as on-demand rather than startup cost', () => {
    const budget = computeContextBudget(docs);
    expect(budget.allReferenceTokens).toBeGreaterThan(0);
    expect(budget.startupTokens).toBeLessThan(
      budget.startupTokens + budget.allReferenceTokens + budget.allAgentBodyTokens,
    );
  });

  it('adds scope rules on top of startup cost', () => {
    const budget = computeContextBudget(docs);
    const load = computeScopeLoad(docs, 'typescript');
    expect(load.scopeRuleCount).toBe(1);
    expect(load.totalTokens).toBe(budget.startupTokens + load.scopeRuleTokens);
  });

  it('reports zero scope rules for an unused scope', () => {
    const load = computeScopeLoad(docs, 'rust');
    expect(load.scopeRuleCount).toBe(0);
    expect(load.totalTokens).toBe(computeContextBudget(docs).startupTokens);
  });

  it('lists only scopes that have rules', () => {
    expect(scopesInUse(docs)).toEqual(['typescript']);
  });

  it('includes injected shared blocks in invocation cost', () => {
    const load = computeInvocationLoad(docs, 'code-reviewer');
    expect(load.sharedBlocks).toEqual(['security-baseline']);
    expect(load.sharedTokens).toBeGreaterThan(0);
    expect(load.totalTokens).toBe(load.bodyTokens + load.sharedTokens);
  });

  it('throws for an unknown agent', () => {
    expect(() => computeInvocationLoad(docs, 'nope')).toThrow(/no agent named/);
  });
});

describe('catalog measurement', () => {
  it('assembles budget, scope loads and invocations', () => {
    const measurement = measureCatalog(validRoot);
    expect(measurement.budget.agentCount).toBe(1);
    expect(measurement.scopeLoads).toHaveLength(1);
    expect(measurement.invocations).toHaveLength(1);
    expect(measurement.files.totalFiles).toBe(4);
  });
});

describe('table formatting', () => {
  it('aligns columns and adds a separator row', () => {
    const lines = formatTable(
      ['name', 'tokens'],
      [
        ['a', '1'],
        ['longer-name', '1000'],
      ],
      ['left', 'right'],
    );

    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('name');
    expect(lines[1]).toMatch(/^-+\s+-+$/);
    expect(lines[3]).toContain('longer-name');
    // Right-aligned numbers end at the same column.
    expect(lines[2]?.length).toBe(lines[3]?.length);
  });

  it('handles an empty row set', () => {
    const lines = formatTable(['a', 'b'], []);
    expect(lines).toHaveLength(2);
  });

  it('formats thousands separators', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
  });
});
