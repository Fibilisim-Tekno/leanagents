import type { ValidationIssue } from './sources.js';

/**
 * Groups issues by file and renders them as aligned, greppable lines.
 * Errors are listed before warnings within each file.
 */
export function formatIssues(issues: ValidationIssue[]): string[] {
  if (issues.length === 0) return [];

  const byFile = new Map<string, ValidationIssue[]>();
  for (const issue of issues) {
    const bucket = byFile.get(issue.file);
    if (bucket) {
      bucket.push(issue);
    } else {
      byFile.set(issue.file, [issue]);
    }
  }

  const lines: string[] = [];
  for (const file of [...byFile.keys()].sort()) {
    const fileIssues = (byFile.get(file) ?? []).slice().sort((a, b) => {
      if (a.level === b.level) return a.message.localeCompare(b.message);
      return a.level === 'error' ? -1 : 1;
    });

    lines.push(file);
    for (const issue of fileIssues) {
      const label = issue.level === 'error' ? 'error  ' : 'warning';
      lines.push(`  ${label}  ${issue.message}`);
    }
  }

  return lines;
}

export function pluralize(count: number, singular: string, plural?: string): string {
  const word = count === 1 ? singular : (plural ?? `${singular}s`);
  return `${count} ${word}`;
}

export type Alignment = 'left' | 'right';

/**
 * Renders an aligned plain-text table. Numeric columns read better
 * right-aligned, so alignment is per column.
 */
export function formatTable(
  headers: string[],
  rows: string[][],
  alignments?: Alignment[],
): string[] {
  const columnCount = headers.length;
  const widths = headers.map((header, index) => {
    const cellWidths = rows.map((row) => (row[index] ?? '').length);
    return Math.max(header.length, ...(cellWidths.length > 0 ? cellWidths : [0]));
  });

  const align = (value: string, index: number): string => {
    const width = widths[index] ?? value.length;
    const alignment = alignments?.[index] ?? 'left';
    return alignment === 'right' ? value.padStart(width) : value.padEnd(width);
  };

  const renderRow = (cells: string[]): string => {
    const parts: string[] = [];
    for (let index = 0; index < columnCount; index += 1) {
      parts.push(align(cells[index] ?? '', index));
    }
    return parts.join('  ').trimEnd();
  };

  const separator = widths.map((width) => '-'.repeat(width)).join('  ');

  return [renderRow(headers), separator, ...rows.map(renderRow)];
}

/** Thousands separators make six-figure token counts readable. */
export function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}
