import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { countTokens } from 'gpt-tokenizer';

/**
 * Tokenizer note, stated plainly because it affects how results should be read:
 *
 * This uses a local GPT tokenizer. Different model families tokenize
 * differently. Counts and ratios describe this tokenizer only, not a model's
 * billed input, reasoning, cached input or output usage. Counting component
 * bodies separately also omits assembly boundaries and harness wrappers.
 */
export const TOKENIZER_NOTE =
  'Counts use a local GPT tokenizer, not billed usage. Both absolute counts and ratios may vary by tokenizer. Context reports are loading-model estimates, not runtime traces.';

export function countTextTokens(text: string): number {
  if (text.length === 0) return 0;
  return countTokens(text);
}

export interface FileMeasurement {
  /** Path relative to the measurement root, with forward slashes. */
  relPath: string;
  absPath: string;
  tokens: number;
  lines: number;
  bytes: number;
}

export interface GroupMeasurement {
  group: string;
  files: number;
  tokens: number;
  lines: number;
}

export interface DirectoryMeasurement {
  rootDir: string;
  files: FileMeasurement[];
  groups: GroupMeasurement[];
  totalTokens: number;
  totalLines: number;
  totalFiles: number;
}

function toPosix(value: string): string {
  return value.split(sep).join('/');
}

export function countLines(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\r?\n/).length;
}

export function measureFile(absPath: string, rootDir?: string): FileMeasurement {
  const text = readFileSync(absPath, 'utf8');
  return {
    relPath: toPosix(rootDir ? relative(rootDir, absPath) : absPath),
    absPath,
    tokens: countTextTokens(text),
    lines: countLines(text),
    bytes: Buffer.byteLength(text, 'utf8'),
  };
}

/** Recursive markdown walk. Mirrors the loader so both see the same files. */
export function collectMarkdownFiles(dir: string): string[] {
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

/** First path segment, used as the grouping key for directory reports. */
function groupOf(relPath: string): string {
  const parts = relPath.split('/');
  return parts.length > 1 ? (parts[0] ?? '(root)') : '(root)';
}

export function measureDirectory(rootDir: string): DirectoryMeasurement {
  const files = collectMarkdownFiles(rootDir).map((abs) => measureFile(abs, rootDir));

  const groupMap = new Map<string, GroupMeasurement>();
  for (const file of files) {
    const key = groupOf(file.relPath);
    const existing = groupMap.get(key);
    if (existing) {
      existing.files += 1;
      existing.tokens += file.tokens;
      existing.lines += file.lines;
    } else {
      groupMap.set(key, { group: key, files: 1, tokens: file.tokens, lines: file.lines });
    }
  }

  const groups = [...groupMap.values()].sort((a, b) => b.tokens - a.tokens);

  return {
    rootDir,
    files,
    groups,
    totalTokens: files.reduce((sum, f) => sum + f.tokens, 0),
    totalLines: files.reduce((sum, f) => sum + f.lines, 0),
    totalFiles: files.length,
  };
}

export interface Comparison {
  baselineLabel: string;
  candidateLabel: string;
  baselineTokens: number;
  candidateTokens: number;
  /** Positive means the candidate uses fewer tokens than the baseline. */
  savedTokens: number;
  /** Percentage saved relative to the baseline, rounded to one decimal. */
  savedPercent: number;
  /** How many times larger the baseline is than the candidate. */
  ratio: number;
}

export function compareTokens(
  baselineLabel: string,
  baselineTokens: number,
  candidateLabel: string,
  candidateTokens: number,
): Comparison {
  const savedTokens = baselineTokens - candidateTokens;
  const savedPercent =
    baselineTokens === 0 ? 0 : Math.round((savedTokens / baselineTokens) * 1000) / 10;
  const ratio =
    candidateTokens === 0 ? 0 : Math.round((baselineTokens / candidateTokens) * 100) / 100;

  return {
    baselineLabel,
    candidateLabel,
    baselineTokens,
    candidateTokens,
    savedTokens,
    savedPercent,
    ratio,
  };
}

/** Measures a file or a directory and returns a single token total. */
export function measurePath(target: string): { tokens: number; files: number; lines: number } {
  if (!existsSync(target)) {
    throw new Error(`path does not exist: ${target}`);
  }

  if (statSync(target).isDirectory()) {
    const measurement = measureDirectory(target);
    return {
      tokens: measurement.totalTokens,
      files: measurement.totalFiles,
      lines: measurement.totalLines,
    };
  }

  const file = measureFile(target);
  return { tokens: file.tokens, files: 1, lines: file.lines };
}
