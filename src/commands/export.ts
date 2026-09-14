import type { Command } from 'commander';
import { exportAdapter } from '../lib/adapters.js';

export function registerExportCommand(program: Command): void {
  program.command('export')
    .description('Generate an editor instruction bundle in a new directory')
    .requiredOption('--target <name>', 'codex, kiro, cursor or antigravity')
    .requiredOption('--out <directory>', 'New output directory; never overwrites existing settings')
    .action((options: { target: string; out: string }) => {
      const manifest = exportAdapter(options.target, options.out);
      console.log(`${manifest.target}: ${manifest.files.length} files; ${manifest.bootstrapTokens} bootstrap tokens (local estimate)`);
      console.log(manifest.activation);
    });
}
