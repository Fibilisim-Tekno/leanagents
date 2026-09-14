import { Command } from 'commander';
import { getVersion } from './lib/pkg.js';
import { registerValidateCommand } from './commands/validate.js';
import { registerMeasureCommand } from './commands/measure.js';
import { registerCheckCommand } from './commands/check.js';
import { registerBenchCommand } from './commands/bench.js';
import { registerRouteCommand } from './commands/route.js';
import { registerPrepareCommand } from './commands/prepare.js';
import { registerReviewCommand } from './commands/review.js';
import { registerFixCommand } from './commands/fix.js';
import { registerExportCommand } from './commands/export.js';
import { registerSetupCommand } from './commands/setup.js';

/**
 * Builds the CLI command tree. Kept free of side effects so tests can
 * construct and inspect it without executing anything.
 */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name('leanagents')
    .description(
      'Selective coding-agent workflow prototype with measured context token budgets.',
    )
    .version(getVersion(), '-v, --version', 'print the leanagents version')
    .showHelpAfterError();

  registerValidateCommand(program);
  registerMeasureCommand(program);
  registerCheckCommand(program);
  registerBenchCommand(program);
  registerRouteCommand(program);
  registerPrepareCommand(program);
  registerReviewCommand(program);
  registerFixCommand(program);
  registerExportCommand(program);
  registerSetupCommand(program);

  return program;
}

export async function run(argv: string[]): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(argv);
}
