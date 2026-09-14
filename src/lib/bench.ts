import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { z } from 'zod';
import { findPackageRoot } from './pkg.js';
import { SCOPES } from './schema.js';
import type { ValidationIssue } from './sources.js';

export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type Severity = (typeof SEVERITIES)[number];

/**
 * A keyword group is an OR set. A defect is considered identified only when
 * every group has at least one term present, which means a reviewer has to
 * name both the subject and the mechanism rather than saying one vague word.
 */
const keywordGroups = z
  .array(z.array(z.string().min(2)).min(1))
  .min(1, 'at least one keyword group is required');

export const defectSchema = z
  .object({
    id: z.string().min(2),
    /** 1-based line in the fixture file where the defect lives. */
    line: z.number().int().positive(),
    /**
     * How far off a reported line may be and still count. Reviewers often cite
     * the function signature or the closing line of a statement.
     */
    lineTolerance: z.number().int().nonnegative().default(3),
    /** Set when the defect is diffuse enough that citing one line is unfair. */
    lineOptional: z.boolean().default(false),
    severity: z.enum(SEVERITIES),
    summary: z.string().min(10),
    keywordGroups,
  })
  .strict();

/**
 * A distractor is something planted deliberately that is *not* a defect.
 * Flagging one is noise, and noise is the main failure mode of LLM reviewers,
 * so it is measured rather than assumed away.
 */
export const distractorSchema = z
  .object({
    id: z.string().min(2),
    summary: z.string().min(10),
    keywordGroups,
  })
  .strict();

export const fixtureSchema = z
  .object({
    id: z.string().min(2),
    language: z.enum(SCOPES),
    /** Code file inside the fixture directory. */
    file: z.string().min(3),
    summary: z.string().min(10),
    /**
     * Marks a fixture that contains no defects at all. Manufacturing findings
     * on clean code is the most common failure of an LLM reviewer, so the
     * correct answer being "nothing" has to be measurable.
     */
    clean: z.boolean().default(false),
    defects: z.array(defectSchema).default([]),
    distractors: z.array(distractorSchema).default([]),
  })
  .strict()
  .refine((value) => value.clean || value.defects.length > 0, {
    message: 'a fixture must declare at least one defect, or set "clean": true',
    path: ['defects'],
  })
  .refine((value) => !value.clean || value.defects.length === 0, {
    message: 'a clean fixture cannot declare defects',
    path: ['defects'],
  });

export type Defect = z.infer<typeof defectSchema>;
export type Distractor = z.infer<typeof distractorSchema>;
export type FixtureManifest = z.infer<typeof fixtureSchema>;

export interface Fixture extends FixtureManifest {
  /** Directory holding the manifest and the code file. */
  dir: string;
  /** Path relative to the bench root, with forward slashes. */
  relPath: string;
  /** Absolute path to the code file. */
  codePath: string;
  code: string;
  codeLineCount: number;
}

export interface BenchLoadResult {
  rootDir: string;
  fixtures: Fixture[];
  issues: ValidationIssue[];
}

export const MANIFEST_FILENAME = 'expected.json';

export function defaultBenchRoot(): string {
  return join(findPackageRoot(), 'bench', 'fixtures');
}

function toPosix(value: string): string {
  return value.split(sep).join('/');
}

/** Fixture directories are any directory containing an expected.json. */
function collectFixtureDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];

  const found: string[] = [];
  if (existsSync(join(dir, MANIFEST_FILENAME))) {
    found.push(dir);
  }

  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...collectFixtureDirs(full));
    }
  }

  return found.sort();
}

function loadFixture(
  dir: string,
  rootDir: string,
): { fixture?: Fixture; issues: ValidationIssue[] } {
  const relPath = toPosix(relative(rootDir, dir));
  const manifestPath = join(dir, MANIFEST_FILENAME);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      issues: [
        { level: 'error', file: `${relPath}/${MANIFEST_FILENAME}`, message: `unreadable: ${message}` },
      ],
    };
  }

  const result = fixtureSchema.safeParse(parsedJson);
  if (!result.success) {
    return {
      issues: result.error.issues.map((issue) => ({
        level: 'error' as const,
        file: `${relPath}/${MANIFEST_FILENAME}`,
        message: `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`,
      })),
    };
  }

  const manifest = result.data;
  const issues: ValidationIssue[] = [];
  const codePath = join(dir, manifest.file);

  if (!existsSync(codePath)) {
    return {
      issues: [
        {
          level: 'error',
          file: `${relPath}/${MANIFEST_FILENAME}`,
          message: `file "${manifest.file}" does not exist in the fixture directory`,
        },
      ],
    };
  }

  const code = readFileSync(codePath, 'utf8');
  const codeLineCount = code.replace(/\r\n/g, '\n').split('\n').length;

  if (manifest.id !== toPosix(relPath).split('/').pop()) {
    issues.push({
      level: 'error',
      file: `${relPath}/${MANIFEST_FILENAME}`,
      message: `id "${manifest.id}" must match the fixture directory name`,
    });
  }

  const seenDefectIds = new Set<string>();
  for (const defect of manifest.defects) {
    if (seenDefectIds.has(defect.id)) {
      issues.push({
        level: 'error',
        file: `${relPath}/${MANIFEST_FILENAME}`,
        message: `duplicate defect id "${defect.id}"`,
      });
    }
    seenDefectIds.add(defect.id);

    // A line number pointing past the file means the fixture drifted from its
    // manifest, which would silently corrupt every score computed from it.
    if (defect.line > codeLineCount) {
      issues.push({
        level: 'error',
        file: `${relPath}/${MANIFEST_FILENAME}`,
        message: `defect "${defect.id}" points at line ${defect.line} but ${manifest.file} has ${codeLineCount} lines`,
      });
    }
  }

  for (const distractor of manifest.distractors) {
    if (seenDefectIds.has(distractor.id)) {
      issues.push({
        level: 'error',
        file: `${relPath}/${MANIFEST_FILENAME}`,
        message: `distractor "${distractor.id}" reuses a defect id`,
      });
    }
  }

  return {
    issues,
    fixture: {
      ...manifest,
      dir,
      relPath,
      codePath,
      code,
      codeLineCount,
    },
  };
}

export function loadFixtures(rootDir: string = defaultBenchRoot()): BenchLoadResult {
  if (!existsSync(rootDir)) {
    return {
      rootDir,
      fixtures: [],
      issues: [
        { level: 'error', file: toPosix(rootDir), message: 'benchmark fixtures directory does not exist' },
      ],
    };
  }

  const fixtures: Fixture[] = [];
  const issues: ValidationIssue[] = [];

  for (const dir of collectFixtureDirs(rootDir)) {
    const loaded = loadFixture(dir, rootDir);
    issues.push(...loaded.issues);
    if (loaded.fixture) fixtures.push(loaded.fixture);
  }

  const seenIds = new Map<string, string>();
  for (const fixture of fixtures) {
    const previous = seenIds.get(fixture.id);
    if (previous) {
      issues.push({
        level: 'error',
        file: `${fixture.relPath}/${MANIFEST_FILENAME}`,
        message: `duplicate fixture id "${fixture.id}", already used by ${previous}`,
      });
    } else {
      seenIds.set(fixture.id, fixture.relPath);
    }
  }

  return { rootDir, fixtures, issues };
}

export function findFixture(fixtures: Fixture[], id: string): Fixture | undefined {
  return fixtures.find((fixture) => fixture.id === id);
}

export function countDefects(fixtures: Fixture[]): number {
  return fixtures.reduce((sum, fixture) => sum + fixture.defects.length, 0);
}

export function countDistractors(fixtures: Fixture[]): number {
  return fixtures.reduce((sum, fixture) => sum + fixture.distractors.length, 0);
}
