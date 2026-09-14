import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { runFix } from '../lib/fix.js';
import { applyFix } from '../lib/apply-fix.js';

export function registerFixCommand(program: Command): void {
  program.command('apply')
    .description('Apply a verified fix after rechecking tests and unchanged originals')
    .requiredOption('--repo <directory>', 'Original repository')
    .requiredOption('--run <directory>', 'Verified fix run')
    .action(async (o: { repo: string; run: string }) => {
      const receipt = await applyFix(o.repo, o.run);
      console.log(`applied: ${receipt.files.join(', ')}`);
    });
  program.command('fix')
    .description('Build and test a bounded TypeScript fix in a new directory; original files are preserved')
    .requiredOption('--repo <directory>', 'Source repository')
    .requiredOption('--spec <file>', 'Task, selected files, editable paths and trusted Node test paths')
    .requiredOption('--out <directory>', 'New workflow output directory')
    .requiredOption('--model <id>', 'Authenticated Codex model; uses existing quota')
    .option('--codex-js <file>', 'Installed Codex JS entrypoint for Windows')
    .action(async (o: { repo: string; spec: string; out: string; model: string; codexJs?: string }) => {
      const result = await runFix({ root: o.repo, spec: JSON.parse(readFileSync(o.spec, 'utf8')),
        out: o.out, model: o.model, executable: o.codexJs ? process.execPath : 'codex',
        prefixArgs: o.codexJs ? [o.codexJs] : [] });
      console.log(`${String(result.status)}: ${o.out}`);
      if (result.status !== 'candidate-verified') process.exitCode = 1;
    });
}
