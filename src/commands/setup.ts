import type { Command } from 'commander';
import { createInterface } from 'node:readline/promises';
import { setup } from '../lib/setup.js';
import { adapterTarget } from '../lib/adapters.js';

export function registerSetupCommand(program: Command) {
  program.command('setup').description('Install LeanAgents instructions in your project without replacing existing settings')
    .option('--target <name>', 'codex, kiro, cursor or antigravity')
    .option('--dir <directory>', 'Existing project directory', '.')
    .option('--dry-run', 'Preview changes without writing')
    .action(async (options: { target?: string; dir: string; dryRun?: boolean }) => {
      let target = options.target;
      if (!target) {
        if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Non-interactive setup requires --target codex|kiro|cursor|antigravity');
        const prompt = createInterface({ input: process.stdin, output: process.stdout });
        try {
          console.log('1. Codex\n2. Kiro\n3. Cursor\n4. Antigravity');
          const answer = (await prompt.question('Choose editor [1]: ')).trim() || '1';
          target = adapterTarget.options[Number(answer) - 1] ?? answer;
        } finally { prompt.close(); }
      }
      const result = setup(target, options.dir, options.dryRun);
      console.log(`${result.dryRun ? 'Preview' : 'Setup complete'}: ${result.target}; ${result.changed.length} files ${result.dryRun ? 'to change' : 'changed'}.`);
      console.log(result.activation);
    });
}
