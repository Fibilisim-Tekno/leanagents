import { z } from 'zod';

/**
 * Languages and frameworks the catalog can target. Kept as a controlled list
 * so the coverage matrix can be checked mechanically instead of by eye.
 */
export const LANGUAGES = [
  'common',
  'typescript',
  'javascript',
  'python',
  'go',
  'rust',
  'java',
  'kotlin',
  'csharp',
  'cpp',
  'swift',
  'php',
  'ruby',
  'dart',
  'sql',
  'bash',
] as const;

export const FRAMEWORKS = [
  'react',
  'vue',
  'angular',
  'nextjs',
  'django',
  'spring',
  'laravel',
  'fastapi',
  'nestjs',
  'flutter',
] as const;

export const SCOPES = [...LANGUAGES, ...FRAMEWORKS] as const;

/** Rule categories. Every supported language needs one rule per category. */
export const RULE_CATEGORIES = [
  'coding-style',
  'patterns',
  'security',
  'testing',
  'performance',
] as const;

/** Catalog target identifiers; see adapter support matrix for implemented exports. */
export const TARGETS = ['codex', 'kiro', 'claude', 'cursor', 'antigravity', 'copilot'] as const;

/**
 * Harness-neutral model tiers. Each adapter maps these to its own model names
 * at build time, so source files never hardcode a vendor model.
 */
export const MODEL_TIERS = ['inherit', 'fast', 'standard', 'deep'] as const;

export type Language = (typeof LANGUAGES)[number];
export type Framework = (typeof FRAMEWORKS)[number];
export type Scope = (typeof SCOPES)[number];
export type RuleCategory = (typeof RULE_CATEGORIES)[number];
export type Target = (typeof TARGETS)[number];
export type ModelTier = (typeof MODEL_TIERS)[number];

/** kebab-case identifier: lowercase, digits, single hyphens between segments. */
export const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * Hard ceiling on agent descriptions. Claude Code warns once the combined
 * descriptions of all subagents pass 15,000 tokens, so descriptions are the
 * one field that costs context on every session regardless of use.
 */
export const MAX_DESCRIPTION_CHARS = 300;

const identifier = z
  .string()
  .min(2, 'must be at least 2 characters')
  .max(64, 'must be at most 64 characters')
  .regex(KEBAB_CASE, 'must be kebab-case, for example "code-reviewer"');

const description = z
  .string()
  .min(20, 'must be at least 20 characters so a harness can route to it')
  .max(
    MAX_DESCRIPTION_CHARS,
    `must be at most ${MAX_DESCRIPTION_CHARS} characters; move detail into the body`,
  );

const scopeField = z.enum(SCOPES);
const targetList = z.array(z.enum(TARGETS)).min(1);
const idList = z.array(identifier);

export const agentFrontmatterSchema = z
  .object({
    name: identifier,
    description,
    scope: scopeField.default('common'),
    tools: z.array(z.string().min(1)).optional(),
    model: z.enum(MODEL_TIERS).default('inherit'),
    targets: targetList.optional(),
    shared: idList.optional(),
    reference: idList.optional(),
    maxTokens: z.number().int().positive().optional(),
  })
  .strict();

export const ruleFrontmatterSchema = z
  .object({
    name: identifier,
    description,
    scope: scopeField.default('common'),
    category: z.enum(RULE_CATEGORIES),
    globs: z.array(z.string().min(1)).optional(),
    alwaysApply: z.boolean().default(false),
    targets: targetList.optional(),
    shared: idList.optional(),
    maxTokens: z.number().int().positive().optional(),
  })
  .strict();

export const sharedFrontmatterSchema = z
  .object({
    name: identifier,
    description,
    maxTokens: z.number().int().positive().optional(),
  })
  .strict();

export const referenceFrontmatterSchema = z
  .object({
    name: identifier,
    description,
    scope: scopeField.default('common'),
    maxTokens: z.number().int().positive().optional(),
  })
  .strict();

export type AgentFrontmatter = z.infer<typeof agentFrontmatterSchema>;
export type RuleFrontmatter = z.infer<typeof ruleFrontmatterSchema>;
export type SharedFrontmatter = z.infer<typeof sharedFrontmatterSchema>;
export type ReferenceFrontmatter = z.infer<typeof referenceFrontmatterSchema>;

export const DOC_KINDS = ['agent', 'rule', 'shared', 'reference'] as const;
export type DocKind = (typeof DOC_KINDS)[number];

/** Directory under sources/ that holds each kind of document. */
export const KIND_DIRECTORIES: Record<DocKind, string> = {
  agent: 'agents',
  rule: 'rules',
  shared: 'shared',
  reference: 'reference',
};

export function schemaForKind(kind: DocKind): z.ZodType {
  switch (kind) {
    case 'agent':
      return agentFrontmatterSchema;
    case 'rule':
      return ruleFrontmatterSchema;
    case 'shared':
      return sharedFrontmatterSchema;
    case 'reference':
      return referenceFrontmatterSchema;
  }
}
