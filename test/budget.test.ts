import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { evaluateBudgets } from '../src/lib/budget.js';
import {
  CONFIG_FILENAME,
  ConfigError,
  DEFAULT_BUDGETS,
  loadConfig,
  parseConfig,
} from '../src/lib/config.js';
import { loadSources } from '../src/lib/sources.js';
import { check, formatCheckSummary, formatHeadroom, formatTotals } from '../src/commands/check.js';
import { KIND_DIRECTORIES, type DocKind } from '../src/lib/schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const validRoot = join(here, 'fixtures', 'sources-valid');
const tempDirs: string[] = [];

function makeSourcesRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'leanagents-budget-'));
  tempDirs.push(dir);
  for (const sub of Object.values(KIND_DIRECTORIES)) {
    mkdirSync(join(dir, sub), { recursive: true });
  }
  return dir;
}

/** Writes a source doc, building the frontmatter from a plain object. */
function writeDoc(
  root: string,
  kind: DocKind,
  name: string,
  frontmatter: Record<string, unknown>,
  body: string,
): void {
  const lines = ['---'];
  for (const [key, value] of Object.entries({ name, ...frontmatter })) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${JSON.stringify(item)}`);
    } else if (typeof value === 'string') {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else {
      lines.push(`${key}: ${String(value)}`);
    }
  }
  lines.push('---', '', body, '');

  writeFileSync(join(root, KIND_DIRECTORIES[kind], `${name}.md`), lines.join('\n'), 'utf8');
}

const OK_DESCRIPTION = 'A description that is long enough to pass the schema minimum length check.';

/** Repeats a sentence to reach roughly the requested number of lines. */
function longBody(lines: number): string {
  return Array.from(
    { length: lines },
    (_, index) => `Line ${index + 1}: report the defect with a cited line and a failure case.`,
  ).join('\n');
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe('config loading', () => {
  it('falls back to defaults when no config file exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'leanagents-noconfig-'));
    tempDirs.push(dir);
    // An explicit missing path is an error, but an absent default is not.
    expect(() => loadConfig(join(dir, CONFIG_FILENAME))).toThrow(ConfigError);
  });

  it('reads the repository config and keeps its documented limits', () => {
    const loaded = loadConfig();
    expect(loaded.configPath).toContain(CONFIG_FILENAME);
    // 15,000 is Claude Code's published warning threshold.
    expect(loaded.budgets.allAgentDescriptionTokens).toBe(15000);
  });

  it('merges a partial config over the defaults', () => {
    const dir = makeSourcesRoot();
    const configPath = join(dir, CONFIG_FILENAME);
    writeFileSync(configPath, JSON.stringify({ budgets: { agentBodyLines: 7 } }), 'utf8');

    const loaded = loadConfig(configPath);
    expect(loaded.budgets.agentBodyLines).toBe(7);
    expect(loaded.budgets.ruleTokens).toBe(DEFAULT_BUDGETS.ruleTokens);
  });

  it('rejects invalid JSON with a readable message', () => {
    expect(() => parseConfig('{ not json', 'test.json')).toThrow(/invalid JSON/);
  });

  it('rejects unknown config keys', () => {
    expect(() => parseConfig(JSON.stringify({ budget: {} }), 'test.json')).toThrow(ConfigError);
  });

  it('rejects a non-positive budget', () => {
    expect(() =>
      parseConfig(JSON.stringify({ budgets: { agentBodyLines: 0 } }), 'test.json'),
    ).toThrow(ConfigError);
  });
});

describe('budget evaluation', () => {
  it('passes a catalog that is inside every limit', () => {
    const report = evaluateBudgets(loadSources(validRoot).docs, DEFAULT_BUDGETS);
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.docs).toHaveLength(4);
  });

  it('reports usage even when nothing fails', () => {
    const report = evaluateBudgets(loadSources(validRoot).docs, DEFAULT_BUDGETS);
    const agent = report.docs.find((doc) => doc.kind === 'agent');
    expect(agent?.tokenLimit).toBe(DEFAULT_BUDGETS.agentBodyTokens);
    expect(agent?.tokenPercent).toBeGreaterThan(0);
    expect(agent?.lineLimit).toBe(DEFAULT_BUDGETS.agentBodyLines);
  });

  it('fails an agent body over the line limit', () => {
    const root = makeSourcesRoot();
    writeDoc(root, 'agent', 'wordy', { description: OK_DESCRIPTION }, longBody(130));

    const report = evaluateBudgets(loadSources(root).docs, DEFAULT_BUDGETS);
    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => /over the 120 line limit/.test(issue.message))).toBe(true);
  });

  it('fails an agent body over the token limit', () => {
    const root = makeSourcesRoot();
    // 120 lines is inside the line limit but well past 1,300 tokens.
    writeDoc(root, 'agent', 'dense', { description: OK_DESCRIPTION }, longBody(120));

    const report = evaluateBudgets(loadSources(root).docs, DEFAULT_BUDGETS);
    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => /token limit/.test(issue.message))).toBe(true);
  });

  it('refuses a per-file maxTokens that raises the ceiling', () => {
    const root = makeSourcesRoot();
    writeDoc(
      root,
      'agent',
      'greedy',
      { description: OK_DESCRIPTION, maxTokens: 99999 },
      'Short body.',
    );

    const report = evaluateBudgets(loadSources(root).docs, DEFAULT_BUDGETS);
    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => /may lower its own limit, not raise it/.test(issue.message))).toBe(
      true,
    );
  });

  it('honours a per-file maxTokens that tightens the ceiling', () => {
    const root = makeSourcesRoot();
    writeDoc(root, 'agent', 'strict', { description: OK_DESCRIPTION, maxTokens: 5 }, longBody(3));

    const report = evaluateBudgets(loadSources(root).docs, DEFAULT_BUDGETS);
    expect(report.ok).toBe(false);
    const usage = report.docs.find((doc) => doc.name === 'strict');
    expect(usage?.tokenLimit).toBe(5);
    expect(usage?.selfLimited).toBe(true);
  });

  it('fails an over-long agent description because it loads every session', () => {
    const root = makeSourcesRoot();
    const budgets = { ...DEFAULT_BUDGETS, agentDescriptionTokens: 5 };
    writeDoc(root, 'agent', 'chatty', { description: OK_DESCRIPTION }, 'Short body.');

    const report = evaluateBudgets(loadSources(root).docs, budgets);
    expect(report.ok).toBe(false);
    expect(
      report.issues.some((issue) => /descriptions load every session/.test(issue.message)),
    ).toBe(true);
  });

  it('fails a rule over the rule line limit', () => {
    const root = makeSourcesRoot();
    writeDoc(
      root,
      'rule',
      'verbose-rule',
      { description: OK_DESCRIPTION, category: 'patterns', alwaysApply: true },
      longBody(220),
    );

    const report = evaluateBudgets(loadSources(root).docs, DEFAULT_BUDGETS);
    expect(report.issues.some((issue) => /over the 200 line limit/.test(issue.message))).toBe(true);
  });

  it('fails when combined agent descriptions exceed the catalog total', () => {
    const root = makeSourcesRoot();
    const budgets = { ...DEFAULT_BUDGETS, allAgentDescriptionTokens: 10 };
    writeDoc(root, 'agent', 'one', { description: OK_DESCRIPTION }, 'Short body.');
    writeDoc(root, 'agent', 'two', { description: OK_DESCRIPTION }, 'Short body.');

    const report = evaluateBudgets(loadSources(root).docs, budgets);
    expect(report.ok).toBe(false);
    expect(
      report.issues.some(
        (issue) => issue.file === '(catalog)' && /all agent descriptions/.test(issue.message),
      ),
    ).toBe(true);
  });

  it('fails when startup context exceeds its limit', () => {
    const root = makeSourcesRoot();
    const budgets = { ...DEFAULT_BUDGETS, startupTokens: 10 };
    writeDoc(
      root,
      'rule',
      'always-on',
      { description: OK_DESCRIPTION, category: 'security', alwaysApply: true },
      longBody(5),
    );

    const report = evaluateBudgets(loadSources(root).docs, budgets);
    expect(report.ok).toBe(false);
    expect(
      report.issues.some(
        (issue) => issue.file === '(catalog)' && /startup context/.test(issue.message),
      ),
    ).toBe(true);
  });

  it('sorts usage with the tightest file first', () => {
    const root = makeSourcesRoot();
    writeDoc(root, 'agent', 'small', { description: OK_DESCRIPTION }, longBody(2));
    writeDoc(root, 'agent', 'larger', { description: OK_DESCRIPTION }, longBody(40));

    const report = evaluateBudgets(loadSources(root).docs, DEFAULT_BUDGETS);
    expect(report.docs[0]?.name).toBe('larger');
  });
});

describe('check command', () => {
  it('passes on the valid fixture and reports totals', () => {
    const result = check({ sourcesDir: validRoot });
    expect(result.ok).toBe(true);
    expect(result.errorCount).toBe(0);
    expect(formatCheckSummary(result).join('\n')).toContain('within budget');
    expect(formatTotals(result.report).join('\n')).toContain('startup context');
  });

  it('surfaces schema errors and budget errors from the same run', () => {
    const root = makeSourcesRoot();
    // Over budget.
    writeDoc(root, 'agent', 'wordy', { description: OK_DESCRIPTION }, longBody(130));
    // Schema invalid: name does not match the filename.
    writeFileSync(
      join(root, 'agents', 'mismatch.md'),
      `---\nname: other-name\ndescription: ${JSON.stringify(OK_DESCRIPTION)}\n---\n\nBody.\n`,
      'utf8',
    );

    const result = check({ sourcesDir: root });
    expect(result.ok).toBe(false);
    expect(result.schemaIssues.length).toBeGreaterThan(0);
    expect(result.budgetIssues.length).toBeGreaterThan(0);
    expect(formatCheckSummary(result).join('\n')).toContain('Budget check failed');
  });

  it('renders a headroom table naming the file and its percentage', () => {
    const result = check({ sourcesDir: validRoot });
    const text = formatHeadroom(result.report).join('\n');
    expect(text).toContain('agents/code-reviewer.md');
    expect(text).toMatch(/%/);
  });

  it('reports an empty headroom table for an empty catalog', () => {
    const result = check({ sourcesDir: makeSourcesRoot() });
    expect(formatHeadroom(result.report)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('propagates a config error instead of silently using defaults', () => {
    expect(() => check({ sourcesDir: validRoot, configPath: join(here, 'no-such-config.json') })).toThrow(
      ConfigError,
    );
  });
});
