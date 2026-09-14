import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import matter from 'gray-matter';
import { findPackageRoot } from './pkg.js';
import {
  DOC_KINDS,
  KIND_DIRECTORIES,
  schemaForKind,
  type AgentFrontmatter,
  type DocKind,
  type ReferenceFrontmatter,
  type RuleFrontmatter,
  type SharedFrontmatter,
} from './schema.js';

export interface SourceDoc {
  kind: DocKind;
  /** Identifier from frontmatter. Must match the filename. */
  name: string;
  /** Absolute path on disk. */
  filePath: string;
  /** Path relative to the sources root, always with forward slashes. */
  relPath: string;
  /** Validated frontmatter. Shape depends on kind. */
  frontmatter: Record<string, unknown>;
  /** Markdown body with frontmatter stripped. */
  body: string;
  /** Lines in the body, ignoring surrounding blank lines. */
  bodyLineCount: number;
}

export interface ValidationIssue {
  level: 'error' | 'warning';
  /** Relative file path, or the sources root for structural problems. */
  file: string;
  message: string;
}

export interface LoadResult {
  rootDir: string;
  docs: SourceDoc[];
  issues: ValidationIssue[];
}

export function defaultSourcesRoot(): string {
  return join(findPackageRoot(), 'sources');
}

/** Recursive markdown walk. Avoids readdir's recursive option for Node 18 support. */
function collectMarkdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];

  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...collectMarkdownFiles(full));
    } else if (entry.endsWith('.md')) {
      found.push(full);
    }
  }
  return found.sort();
}

function toPosix(value: string): string {
  return value.split(sep).join('/');
}

function basenameWithoutMd(filePath: string): string {
  const parts = toPosix(filePath).split('/');
  const last = parts[parts.length - 1] ?? '';
  return last.replace(/\.md$/, '');
}

function countBodyLines(body: string): number {
  const trimmed = body.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\r?\n/).length;
}

/** Formats a Zod issue path like `globs[0]` or `name`. */
function formatIssuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return '(root)';
  return path.reduce<string>((acc, segment) => {
    if (typeof segment === 'number') return `${acc}[${segment}]`;
    return acc.length === 0 ? String(segment) : `${acc}.${String(segment)}`;
  }, '');
}

function parseDoc(
  kind: DocKind,
  filePath: string,
  rootDir: string,
): { doc?: SourceDoc; issues: ValidationIssue[] } {
  const relPath = toPosix(relative(rootDir, filePath));
  const issues: ValidationIssue[] = [];

  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { issues: [{ level: 'error', file: relPath, message: `cannot read file: ${message}` }] };
  }

  let data: Record<string, unknown>;
  let content: string;
  try {
    const parsed = matter(raw);
    data = parsed.data as Record<string, unknown>;
    content = parsed.content;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      issues: [{ level: 'error', file: relPath, message: `invalid YAML frontmatter: ${message}` }],
    };
  }

  if (Object.keys(data).length === 0) {
    return {
      issues: [
        {
          level: 'error',
          file: relPath,
          message: 'missing YAML frontmatter; every source file needs at least name and description',
        },
      ],
    };
  }

  const result = schemaForKind(kind).safeParse(data);
  if (!result.success) {
    for (const issue of result.error.issues) {
      issues.push({
        level: 'error',
        file: relPath,
        message: `${formatIssuePath(issue.path)}: ${issue.message}`,
      });
    }
    return { issues };
  }

  const frontmatter = result.data as Record<string, unknown>;
  const name = String(frontmatter.name);

  return {
    issues,
    doc: {
      kind,
      name,
      filePath,
      relPath,
      frontmatter,
      body: content,
      bodyLineCount: countBodyLines(content),
    },
  };
}

/** Cross-file checks that a single-document schema cannot express. */
function crossValidate(docs: SourceDoc[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Map<string, string>();
  const sharedNames = new Set(docs.filter((d) => d.kind === 'shared').map((d) => d.name));
  const referenceNames = new Set(docs.filter((d) => d.kind === 'reference').map((d) => d.name));

  for (const doc of docs) {
    const expected = basenameWithoutMd(doc.filePath);
    if (doc.name !== expected) {
      issues.push({
        level: 'error',
        file: doc.relPath,
        message: `name "${doc.name}" must match the filename "${expected}.md"`,
      });
    }

    const key = `${doc.kind}:${doc.name}`;
    const previous = seen.get(key);
    if (previous) {
      issues.push({
        level: 'error',
        file: doc.relPath,
        message: `duplicate ${doc.kind} name "${doc.name}", already defined in ${previous}`,
      });
    } else {
      seen.set(key, doc.relPath);
    }

    if (doc.bodyLineCount === 0) {
      issues.push({
        level: 'error',
        file: doc.relPath,
        message: 'body is empty; a source file must contain instructions',
      });
    }

    for (const ref of asStringArray(doc.frontmatter.shared)) {
      if (!sharedNames.has(ref)) {
        issues.push({
          level: 'error',
          file: doc.relPath,
          message: `shared block "${ref}" does not exist in sources/shared`,
        });
      }
    }

    for (const ref of asStringArray(doc.frontmatter.reference)) {
      if (!referenceNames.has(ref)) {
        issues.push({
          level: 'error',
          file: doc.relPath,
          message: `reference "${ref}" does not exist in sources/reference`,
        });
      }
    }

    if (doc.kind === 'rule') {
      const globs = asStringArray(doc.frontmatter.globs);
      const alwaysApply = doc.frontmatter.alwaysApply === true;
      if (!alwaysApply && globs.length === 0) {
        issues.push({
          level: 'warning',
          file: doc.relPath,
          message:
            'rule has no globs and alwaysApply is false, so it only loads when explicitly requested',
        });
      }
      if (alwaysApply && globs.length > 0) {
        issues.push({
          level: 'warning',
          file: doc.relPath,
          message: 'alwaysApply is true, so globs are ignored by the harness',
        });
      }
    }

    if (doc.kind === 'agent') {
      const targets = asStringArray(doc.frontmatter.targets);
      if (targets.includes('copilot')) {
        issues.push({
          level: 'warning',
          file: doc.relPath,
          message:
            'GitHub Copilot has no subagent API, so this agent cannot be delegated to there',
        });
      }
    }
  }

  return issues;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

export function loadSources(rootDir: string = defaultSourcesRoot()): LoadResult {
  const issues: ValidationIssue[] = [];

  if (!existsSync(rootDir)) {
    return {
      rootDir,
      docs: [],
      issues: [
        { level: 'error', file: toPosix(rootDir), message: 'sources directory does not exist' },
      ],
    };
  }

  const docs: SourceDoc[] = [];
  for (const kind of DOC_KINDS) {
    const dir = join(rootDir, KIND_DIRECTORIES[kind]);
    for (const filePath of collectMarkdownFiles(dir)) {
      const parsed = parseDoc(kind, filePath, rootDir);
      issues.push(...parsed.issues);
      if (parsed.doc) docs.push(parsed.doc);
    }
  }

  issues.push(...crossValidate(docs));

  return { rootDir, docs, issues };
}

export function docsOfKind(docs: SourceDoc[], kind: 'agent'): (SourceDoc & { frontmatter: AgentFrontmatter })[];
export function docsOfKind(docs: SourceDoc[], kind: 'rule'): (SourceDoc & { frontmatter: RuleFrontmatter })[];
export function docsOfKind(docs: SourceDoc[], kind: 'shared'): (SourceDoc & { frontmatter: SharedFrontmatter })[];
export function docsOfKind(
  docs: SourceDoc[],
  kind: 'reference',
): (SourceDoc & { frontmatter: ReferenceFrontmatter })[];
export function docsOfKind(docs: SourceDoc[], kind: DocKind): SourceDoc[] {
  return docs.filter((doc) => doc.kind === kind);
}

export function countErrors(issues: ValidationIssue[]): number {
  return issues.filter((issue) => issue.level === 'error').length;
}

export function countWarnings(issues: ValidationIssue[]): number {
  return issues.filter((issue) => issue.level === 'warning').length;
}
