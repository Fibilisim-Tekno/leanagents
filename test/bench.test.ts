import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  MANIFEST_FILENAME,
  countDefects,
  countDistractors,
  findFixture,
  fixtureSchema,
  loadFixtures,
} from '../src/lib/bench.js';
import { countErrors } from '../src/lib/sources.js';
import { formatFixtureDetail, formatFixtureTable } from '../src/commands/bench.js';

const tempDirs: string[] = [];

function makeBenchRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'leanagents-bench-'));
  tempDirs.push(dir);
  return dir;
}

/** Writes a fixture directory with a manifest and a code file. */
function writeFixture(
  root: string,
  id: string,
  manifest: Record<string, unknown>,
  code = 'const a = 1;\nconst b = 2;\nconst c = 3;\n',
): void {
  const dir = join(root, 'typescript', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, MANIFEST_FILENAME), JSON.stringify({ id, ...manifest }, null, 2), 'utf8');
  writeFileSync(join(dir, 'input.ts'), code, 'utf8');
}

const BASE_MANIFEST = {
  language: 'typescript',
  file: 'input.ts',
  summary: 'A manifest used to exercise the loader.',
};

const ONE_DEFECT = {
  id: 'some-defect',
  line: 2,
  severity: 'high',
  summary: 'A defect that exists on line two of the fixture.',
  keywordGroups: [['alpha', 'beta']],
};

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe('shipped fixtures', () => {
  const { fixtures, issues } = loadFixtures();

  it('load without errors', () => {
    expect(countErrors(issues)).toBe(0);
  });

  it('include at least ten fixtures', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(10);
  });

  it('include a clean fixture so zero findings is measurable', () => {
    const clean = fixtures.filter((fixture) => fixture.clean);
    expect(clean.length).toBeGreaterThanOrEqual(1);
    expect(clean[0]?.defects).toEqual([]);
    expect(clean[0]?.distractors.length).toBeGreaterThan(0);
  });

  it('plant distractors in every fixture so noise is measurable', () => {
    for (const fixture of fixtures) {
      expect(
        fixture.distractors.length,
        `${fixture.id} has no distractors, so it cannot measure false positives`,
      ).toBeGreaterThan(0);
    }
  });

  it('point every defect at a line inside its file', () => {
    for (const fixture of fixtures) {
      for (const defect of fixture.defects) {
        expect(defect.line).toBeLessThanOrEqual(fixture.codeLineCount);
      }
    }
  });

  it('require two keyword groups for most defects so one vague word is not enough', () => {
    const multiGroup = fixtures
      .flatMap((fixture) => fixture.defects)
      .filter((defect) => defect.keywordGroups.length >= 2);
    expect(multiGroup.length).toBe(countDefects(fixtures));
  });

  it('cover several defect categories rather than one', () => {
    const severities = new Set(
      fixtures.flatMap((fixture) => fixture.defects.map((defect) => defect.severity)),
    );
    expect(severities.size).toBeGreaterThanOrEqual(2);
    expect(countDefects(fixtures)).toBeGreaterThanOrEqual(15);
    expect(countDistractors(fixtures)).toBeGreaterThanOrEqual(10);
  });

  it('can be looked up by id', () => {
    expect(findFixture(fixtures, 'sql-injection-user-lookup')).toBeDefined();
    expect(findFixture(fixtures, 'nope')).toBeUndefined();
  });
});

describe('fixture schema', () => {
  it('rejects a fixture with no defects and no clean flag', () => {
    const parsed = fixtureSchema.safeParse({ ...BASE_MANIFEST, id: 'sample-fixture', defects: [] });
    expect(parsed.success).toBe(false);
  });

  it('rejects a clean fixture that also declares defects', () => {
    const parsed = fixtureSchema.safeParse({
      ...BASE_MANIFEST,
      id: 'sample-fixture',
      clean: true,
      defects: [ONE_DEFECT],
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts a clean fixture with only distractors', () => {
    const parsed = fixtureSchema.safeParse({
      ...BASE_MANIFEST,
      id: 'sample-fixture',
      clean: true,
      defects: [],
      distractors: [
        { id: 'noise', summary: 'Something that is not a defect.', keywordGroups: [['abc']] },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects unknown manifest keys', () => {
    const parsed = fixtureSchema.safeParse({
      ...BASE_MANIFEST,
      id: 'sample-fixture',
      defects: [ONE_DEFECT],
      severityWeight: 2,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a one-character keyword', () => {
    const parsed = fixtureSchema.safeParse({
      ...BASE_MANIFEST,
      id: 'sample-fixture',
      defects: [{ ...ONE_DEFECT, keywordGroups: [['a']] }],
    });
    expect(parsed.success).toBe(false);
  });

  it('defaults lineTolerance and lineOptional', () => {
    const parsed = fixtureSchema.parse({ ...BASE_MANIFEST, id: 'sample-fixture', defects: [ONE_DEFECT] });
    expect(parsed.defects[0]?.lineTolerance).toBe(3);
    expect(parsed.defects[0]?.lineOptional).toBe(false);
    expect(parsed.clean).toBe(false);
  });
});

describe('fixture loader errors', () => {
  it('errors when the bench root does not exist', () => {
    const result = loadFixtures(join(makeBenchRoot(), 'missing'));
    expect(countErrors(result.issues)).toBe(1);
    expect(result.issues[0]?.message).toMatch(/does not exist/);
  });

  it('reports an id that does not match the directory name', () => {
    const root = makeBenchRoot();
    const dir = join(root, 'typescript', 'actual-name');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, MANIFEST_FILENAME),
      JSON.stringify({ ...BASE_MANIFEST, id: 'other-name', defects: [ONE_DEFECT] }),
      'utf8',
    );
    writeFileSync(join(dir, 'input.ts'), 'const a = 1;\nconst b = 2;\n', 'utf8');

    const result = loadFixtures(root);
    expect(result.issues.some((issue) => /must match the fixture directory name/.test(issue.message))).toBe(
      true,
    );
  });

  it('reports a defect line past the end of the file', () => {
    const root = makeBenchRoot();
    writeFixture(root, 'drifted', { ...BASE_MANIFEST, defects: [{ ...ONE_DEFECT, line: 999 }] });

    const result = loadFixtures(root);
    expect(result.issues.some((issue) => /points at line 999/.test(issue.message))).toBe(true);
  });

  it('reports a missing code file', () => {
    const root = makeBenchRoot();
    const dir = join(root, 'typescript', 'no-code');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, MANIFEST_FILENAME),
      JSON.stringify({ ...BASE_MANIFEST, id: 'no-code', defects: [ONE_DEFECT] }),
      'utf8',
    );

    const result = loadFixtures(root);
    expect(result.issues.some((issue) => /does not exist in the fixture directory/.test(issue.message))).toBe(
      true,
    );
  });

  it('reports a duplicate defect id inside one fixture', () => {
    const root = makeBenchRoot();
    writeFixture(root, 'dupes', { ...BASE_MANIFEST, defects: [ONE_DEFECT, ONE_DEFECT] });

    const result = loadFixtures(root);
    expect(result.issues.some((issue) => /duplicate defect id/.test(issue.message))).toBe(true);
  });

  it('reports unreadable JSON', () => {
    const root = makeBenchRoot();
    const dir = join(root, 'typescript', 'broken');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, MANIFEST_FILENAME), '{ not json', 'utf8');

    const result = loadFixtures(root);
    expect(result.issues.some((issue) => /unreadable/.test(issue.message))).toBe(true);
  });
});

describe('bench list output', () => {
  const { fixtures } = loadFixtures();

  it('marks clean fixtures in the table instead of showing zero', () => {
    const table = formatFixtureTable(fixtures).join('\n');
    expect(table).toMatch(/clean-pagination-helper\s+typescript\s+clean/);
  });

  it('says no fixtures when the list is empty', () => {
    expect(formatFixtureTable([])).toEqual(['No fixtures found.']);
  });

  it('shows defects and distractors in the detail view', () => {
    const fixture = findFixture(fixtures, 'swallowed-payment-error');
    expect(fixture).toBeDefined();
    const detail = formatFixtureDetail(fixture!).join('\n');
    expect(detail).toContain('Known defects');
    expect(detail).toContain('swallowed-error-marks-paid');
    expect(detail).toContain('Planted distractors');
  });

  it('states the expectation for a clean fixture', () => {
    const fixture = findFixture(fixtures, 'clean-pagination-helper');
    const detail = formatFixtureDetail(fixture!).join('\n');
    expect(detail).toContain('zero findings');
    expect(detail).not.toContain('Known defects');
  });
});
