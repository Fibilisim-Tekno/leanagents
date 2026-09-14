import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { routeTask } from '../lib/route.js';

export function registerRouteCommand(program: Command): void {
  program.command('route')
    .description('Plan only the necessary reviewer from explicit task facts; does not execute agents')
    .requiredOption('--task <file>', 'JSON task with kind, scope, risk and behaviorChange')
    .action((options: { task: string }) => {
      const plan = routeTask(JSON.parse(readFileSync(options.task, 'utf8')) as unknown);
      console.log(JSON.stringify(plan, null, 2));
    });
}
