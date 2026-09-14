import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { runSnapshotReview } from '../lib/review.js';

export function registerReviewCommand(program: Command): void {
  program.command('review')
    .description('Send explicit source files to the authenticated Codex CLI for a snapshot review (uses account quota)')
    .requiredOption('--repo <directory>', 'Source repository')
    .requiredOption('--files <paths...>', 'Explicit source files relative to repository')
    .requiredOption('--request <file>', 'Review request text file')
    .requiredOption('--out <directory>', 'New local run directory')
    .requiredOption('--model <id>', 'Model ID available to the authenticated account')
    .option('--codex-js <file>', 'Codex CLI JS entrypoint (Windows); executed with Node, not a shell')
    .action(async (o: { repo: string; files: string[]; request: string; out: string; model: string; codexJs?: string }) => {
      const result = await runSnapshotReview({ root: o.repo, files: o.files,
        request: readFileSync(o.request, 'utf8'), out: o.out, model: o.model,
        executable: o.codexJs ? process.execPath : 'codex', prefixArgs: o.codexJs ? [o.codexJs] : [],
      });
      console.log(`${result.status}: ${o.out}`);
      if (result.status !== 'response-received') process.exitCode = 1;
    });
}
