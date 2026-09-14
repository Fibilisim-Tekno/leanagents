import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { loadSources, countErrors, countWarnings, docsOfKind } from '../src/lib/sources.js';
import { formatIssues } from '../src/lib/report.js';
import { formatValidateSummary, validate } from '../src/commands/validate.js';
import { MAX_DESCRIPTION_CHARS, agentFrontmatterSchema, ruleFrontmatterSchema } from '../src/lib/schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');
const validRoot = join(fixtures, 'sources-valid');
const invalidRoot = join(fixtures, 'sources-invalid');
const duplicateRoot = join(fixtures, 'sources-duplicate');

const tempDirs: string[] = [];

function makeTempSourcesRoot(withSubdirs: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'leanagents-test-'));
  tempDirs.push(dir);
  if (withSubdirs) {
    for (const sub of ['agents', 'rules', 'shared', 'reference']) {
      mkdirSync(join(dir, sub), { recursive: true });
    }
  }
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Collects all issue messages for a file so assertions can be specific. */
function messagesFor(root: string, relPath: string): string[] {
  return loadSources(root)
    .issues.filter((issue) => issue.file === relPath)
    .map((issue) => issue.message);
}

describe('valid sources', () => {
  it('loads every kind of document', () => {
    const result = loadSources(validRoot);
    expect(countErrors(result.issues)).toBe(0);
    expect(result.docs).toHaveLength(4);
    expect(docsOfKind(result.docs, 'agent')).toHaveLength(1);
    expect(docsOfKind(result.docs, 'rule')).toHaveLength(1);
    expect(docsOfKind(result.docs, 'shared')).toHaveLength(1);
    expect(docsOfKind(result.docs, 'reference')).toHaveLength(1);
  });

  it('produces no warnings for a well-formed tree', () => {
    expect(countWarnings(loadSources(validRoot).issues)).toBe(0);
  });

  it('applies schema defaults', () => {
    const [agent] = docsOfKind(loadSources(validRoot).docs, 'agent');
    expect(agent?.frontmatter.model).toBe('standard');
    expect(agent?.frontmatter.scope).toBe('typescript');

    const [rule] = docsOfKind(loadSources(validRoot).docs, 'rule');
    // alwaysApply is absent in the file and must default to false.
    expect(rule?.frontmatter.alwaysApply).toBe(false);
  });

  it('strips frontmatter from the body and counts only body lines', () => {
    const [agent] = docsOfKind(loadSources(validRoot).docs, 'agent');
    expect(agent?.body).not.toContain('description:');
    expect(agent?.bodyLineCount).toBeGreaterThan(0);
    expect(agent?.bodyLineCount).toBeLessThan(10);
  });

  it('reports ok through the validate command', () => {
    const result = validate(validRoot);
    expect(result.ok).toBe(true);
    expect(result.errorCount).toBe(0);
    expect(formatValidateSummary(result).join('\n')).toContain('valid');
  });
});

describe('invalid sources', () => {
  it('rejects a name that is not kebab-case', () => {
    expect(messagesFor(invalidRoot, 'agents/Bad_Name.md').join('\n')).toMatch(/kebab-case/);
  });

  it('rejects a description longer than the ceiling', () => {
    const messages = messagesFor(invalidRoot, 'agents/long-description.md').join('\n');
    expect(messages).toContain('description');
    expect(messages).toContain(String(MAX_DESCRIPTION_CHARS));
  });

  it('rejects unknown frontmatter keys instead of ignoring them', () => {
    expect(messagesFor(invalidRoot, 'agents/unknown-field.md').length).toBeGreaterThan(0);
  });

  it('reports a missing frontmatter block clearly', () => {
    expect(messagesFor(invalidRoot, 'agents/no-frontmatter.md').join('\n')).toMatch(
      /missing YAML frontmatter/,
    );
  });

  it('reports an empty body', () => {
    expect(messagesFor(invalidRoot, 'agents/empty-body.md').join('\n')).toMatch(/body is empty/);
  });

  it('reports a name that does not match its filename', () => {
    expect(messagesFor(invalidRoot, 'agents/mismatched-file.md').join('\n')).toMatch(
      /must match the filename/,
    );
  });

  it('reports a shared block that does not exist', () => {
    expect(messagesFor(invalidRoot, 'agents/missing-shared.md').join('\n')).toMatch(
      /shared block "does-not-exist" does not exist/,
    );
  });

  it('warns about a rule that no harness will auto-load', () => {
    const issues = loadSources(invalidRoot).issues.filter(
      (issue) => issue.file === 'rules/unreachable-rule.md',
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.level).toBe('warning');
    expect(issues[0]?.message).toMatch(/only loads when explicitly requested/);
  });

  it('fails the validate command with a non-zero error count', () => {
    const result = validate(invalidRoot);
    expect(result.ok).toBe(false);
    expect(result.errorCount).toBeGreaterThan(0);
  });
});

describe('duplicate names', () => {
  it('reports a collision and names the file that defined it first', () => {
    const messages = loadSources(duplicateRoot)
      .issues.map((issue) => issue.message)
      .join('\n');
    expect(messages).toMatch(/duplicate agent name "dup-agent"/);
    expect(messages).toMatch(/agents\/group-a\/dup-agent\.md/);
  });
});

describe('edge cases', () => {
  it('errors when the sources directory is missing', () => {
    const result = loadSources(join(fixtures, 'does-not-exist'));
    expect(countErrors(result.issues)).toBe(1);
    expect(result.issues[0]?.message).toMatch(/does not exist/);
  });

  it('accepts an existing but empty sources tree without errors', () => {
    const result = validate(makeTempSourcesRoot(true));
    expect(result.errorCount).toBe(0);
    expect(result.docs).toHaveLength(0);
    expect(formatValidateSummary(result).join('\n')).toContain('No source documents found');
  });

  it('accepts a sources root with no kind directories at all', () => {
    const result = validate(makeTempSourcesRoot(false));
    expect(result.errorCount).toBe(0);
    expect(result.docs).toHaveLength(0);
  });
});

describe('schema units', () => {
  it('requires a category on rules', () => {
    const parsed = ruleFrontmatterSchema.safeParse({
      name: 'x-rule',
      description: 'A description that is comfortably longer than the twenty character minimum.',
    });
    expect(parsed.success).toBe(false);
  });

  it('defaults agent model to inherit and scope to common', () => {
    const parsed = agentFrontmatterSchema.parse({
      name: 'x-agent',
      description: 'A description that is comfortably longer than the twenty character minimum.',
    });
    expect(parsed.model).toBe('inherit');
    expect(parsed.scope).toBe('common');
  });

  it('rejects an unknown scope', () => {
    const parsed = agentFrontmatterSchema.safeParse({
      name: 'x-agent',
      description: 'A description that is comfortably longer than the twenty character minimum.',
      scope: 'cobol',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('issue formatting', () => {
  it('groups issues by file and puts errors before warnings', () => {
    const lines = formatIssues([
      { level: 'warning', file: 'b.md', message: 'second warning' },
      { level: 'error', file: 'b.md', message: 'first error' },
      { level: 'error', file: 'a.md', message: 'an error' },
    ]);

    expect(lines[0]).toBe('a.md');
    expect(lines[1]).toContain('error');
    expect(lines[2]).toBe('b.md');
    expect(lines[3]).toContain('first error');
    expect(lines[4]).toContain('second warning');
  });

  it('returns nothing when there are no issues', () => {
    expect(formatIssues([])).toEqual([]);
  });
});
