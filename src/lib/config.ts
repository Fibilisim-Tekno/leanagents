import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { findPackageRoot } from './pkg.js';

export const CONFIG_FILENAME = 'leanagents.config.json';

/**
 * Budget ceilings, in the units each one names.
 *
 * Two of these come from published harness limits rather than taste:
 *
 * - `allAgentDescriptionTokens` is 15,000 because Claude Code warns at startup
 *   once the combined descriptions of custom subagents pass that figure.
 * - Cursor documents a 500-line guideline for rule files. The ceiling here is
 *   deliberately tighter so output stays comfortably inside it.
 */
export const budgetsSchema = z
  .object({
    /** Lines in an agent body, frontmatter excluded. */
    agentBodyLines: z.number().int().positive(),
    /** Tokens in an agent body, frontmatter excluded. */
    agentBodyTokens: z.number().int().positive(),
    /** Tokens in a single agent description. Loaded every session. */
    agentDescriptionTokens: z.number().int().positive(),
    /** Lines in a rule body. */
    ruleLines: z.number().int().positive(),
    /** Tokens in a rule body. */
    ruleTokens: z.number().int().positive(),
    /** Tokens in a shared block, which is injected into every agent using it. */
    sharedTokens: z.number().int().positive(),
    /** Tokens in a reference file. Loaded on demand, so this can be generous. */
    referenceTokens: z.number().int().positive(),
    /** Combined agent descriptions. Claude Code warns above 15,000. */
    allAgentDescriptionTokens: z.number().int().positive(),
    /** Everything a harness loads every session, whatever the task. */
    startupTokens: z.number().int().positive(),
  })
  .strict();

export const configSchema = z
  .object({
    $schema: z.string().optional(),
    /** Free-form rationale, keyed by budget name. Not enforced, just kept close to the numbers. */
    notes: z.record(z.string(), z.string()).optional(),
    budgets: budgetsSchema.partial().optional(),
  })
  .strict();

export type Budgets = z.infer<typeof budgetsSchema>;
export type LeanAgentsConfig = z.infer<typeof configSchema>;

export const DEFAULT_BUDGETS: Budgets = {
  agentBodyLines: 120,
  agentBodyTokens: 1300,
  agentDescriptionTokens: 60,
  ruleLines: 200,
  ruleTokens: 1500,
  sharedTokens: 500,
  referenceTokens: 3000,
  allAgentDescriptionTokens: 15000,
  startupTokens: 20000,
};

export interface LoadedConfig {
  budgets: Budgets;
  /** Path the config was read from, or undefined when defaults were used. */
  configPath?: string;
}

export class ConfigError extends Error {}

export function parseConfig(raw: string, sourceLabel: string): LeanAgentsConfig {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`${sourceLabel}: invalid JSON: ${message}`);
  }

  const result = configSchema.safeParse(parsedJson);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
        return `${path}: ${issue.message}`;
      })
      .join('; ');
    throw new ConfigError(`${sourceLabel}: ${details}`);
  }

  return result.data;
}

/**
 * Loads budgets from an explicit path, or from the package root when present.
 * Missing config is not an error: the defaults are the intended baseline.
 */
export function loadConfig(explicitPath?: string): LoadedConfig {
  const candidate = explicitPath ?? join(findPackageRoot(), CONFIG_FILENAME);

  if (!existsSync(candidate)) {
    if (explicitPath) {
      throw new ConfigError(`config file does not exist: ${explicitPath}`);
    }
    return { budgets: { ...DEFAULT_BUDGETS } };
  }

  const config = parseConfig(readFileSync(candidate, 'utf8'), candidate);
  return {
    budgets: { ...DEFAULT_BUDGETS, ...(config.budgets ?? {}) },
    configPath: candidate,
  };
}
