import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { prepareTask, writeTaskPacket } from '../lib/prepare.js';

export function registerPrepareCommand(program: Command): void {
  program.command('prepare')
    .description('Create a selected-content task packet; does not execute agents')
    .requiredOption('--task <file>', 'Task facts JSON')
    .requiredOption('--request <file>', 'Plain-text task request')
    .requiredOption('--out <directory>', 'New output directory (must not exist)')
    .action((options: { task: string; request: string; out: string }) => {
      const packet = prepareTask(JSON.parse(readFileSync(options.task, 'utf8')) as unknown,
        readFileSync(options.request, 'utf8'));
      writeTaskPacket(packet, options.out);
      console.log(`Prepared ${packet.agents.length} selected reviewer packet(s). Execution: not-run.`);
    });
}
