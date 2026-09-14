#!/usr/bin/env node
import { run } from './cli.js';

run(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`leanagents: ${message}`);
  process.exitCode = 1;
});
