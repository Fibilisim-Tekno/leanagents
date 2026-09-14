import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { prepareTask } from './prepare.js';
import { countTextTokens } from './tokens.js';

export const adapterTarget = z.enum(['codex', 'kiro', 'cursor', 'antigravity']);
type Target = z.infer<typeof adapterTarget>;
const definitions: Record<Target, { path: string; header: string; source: string; activation: string }> = {
  codex: { path: 'AGENTS.md', header: '',
    source: 'https://learn.chatgpt.com/docs/agent-configuration/agents-md', activation: 'Project instructions at session start; existing override files can take precedence.' },
  kiro: { path: '.kiro/steering/leanagents.md', header: '---\ninclusion: always\n---\n\n',
    source: 'https://kiro.dev/docs/steering/', activation: 'Workspace steering; custom agents require explicit resources configuration.' },
  cursor: { path: '.cursor/rules/leanagents.mdc', header: '---\nalwaysApply: true\n---\n\n',
    source: 'https://cursor.com/docs/rules', activation: 'Always-apply project rule.' },
  antigravity: { path: '.agents/rules/leanagents.md', header: '---\ntrigger: always_on\n---\n\n',
    source: 'https://antigravity.google/docs/rules-workflows', activation: 'Always On workspace rule (trigger: always_on).' },
};

export function renderAdapter(targetInput: unknown) {
  const target = adapterTarget.parse(targetInput);
  const definition = definitions[target];
  const bootstrap = [
    '# LeanAgents task routing',
    'Follow the repository instructions and existing conventions. Inspect the task, affected files and risk before choosing extra guidance.',
    'Keep low-risk documentation-only changes on the host; do not load a reviewer for them.',
    'For TypeScript behavior changes or explicit code reviews, read `.leanagents/reviewers/code-reviewer.md` from the project root only when review begins.',
    'Implement on the host. Use at most one reviewer; do not create a planner/developer/tester chain or recursively review a review.',
    'If independent review is unavailable, label the result as host review. Do not claim independence.',
    'Unknown scope or sensitive work requires explicit assessment; no security specialist is bundled. Do not silently treat unknown risk as low.',
    'Run relevant tests, inspect the final diff, and report failures or missing context. Never claim a skipped check passed.',
  ].join('\n\n') + '\n';
  const packet = prepareTask({ kind: 'review', scope: 'typescript', risk: 'normal', behaviorChange: true },
    'Review the current user task and its changes. Follow the evidence gate; read references only if needed.');
  const files = [{ path: definition.path, content: definition.header + bootstrap }];
  for (const agent of packet.agents) {
    files.push({ path: `.leanagents/reviewers/${agent.name}.md`,
      content: agent.prompt.replaceAll('references/', '.leanagents/references/').replaceAll('(relative to this packet)', '(relative to project root)') });
    for (const reference of agent.references) {
      files.push({ path: `.leanagents/references/${reference.name}.md`, content: reference.content });
    }
  }
  return { target, files, source: definition.source, sourceChecked: '2026-09-14',
    activation: definition.activation, verification: 'generated-format-tested; native runtime not implied',
    bootstrapTokens: countTextTokens(definition.header + bootstrap),
    tokenMeaning: 'Local text count only. Guidance selection is performed by the host; it is not an enforced scheduler.' };
}

/** Export into an exclusively created directory; never merge into live editor settings. */
export function exportAdapter(targetInput: unknown, outputDir: string) {
  const adapter = renderAdapter(targetInput);
  mkdirSync(outputDir);
  for (const file of adapter.files) {
    const output = join(outputDir, file.path);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, file.content, { flag: 'wx' });
  }
  const manifest = { ...adapter, files: adapter.files.map(({ path, content }) => ({ path,
    sha256: createHash('sha256').update(content).digest('hex'), tokens: countTextTokens(content) })) };
  writeFileSync(join(outputDir, 'leanagents-adapter.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
  return manifest;
}
