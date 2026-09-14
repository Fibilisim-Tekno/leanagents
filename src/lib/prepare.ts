import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { routeTask } from './route.js';
import { countTextTokens } from './tokens.js';
import { loadSources, defaultSourcesRoot } from './sources.js';

/** Assemble selected content only. No editor settings, model calls or source edits. */
export function prepareTask(input: unknown, taskText: string, sourcesDir = defaultSourcesRoot()) {
  if (!taskText.trim()) throw new Error('Task text must not be empty');
  const plan = routeTask(input);
  if (plan.unresolved.length) throw new Error(`Unresolved task: ${plan.unresolved.join(' ')}`);
  const catalog = loadSources(sourcesDir);
  const errors = catalog.issues.filter((issue) => issue.level === 'error');
  if (errors.length) throw new Error(`Invalid source catalog: ${errors.map((e) => e.message).join('; ')}`);
  const names = [...new Set([
    ...(plan.executor === 'code-reviewer' ? ['code-reviewer'] : []), ...plan.additionalAgents,
  ])];
  const agents = names.map((name) => {
    const doc = catalog.docs.find((d) => d.kind === 'agent' && d.name === name);
    if (!doc) throw new Error(`Missing selected agent: ${name}`);
    const shared = [...new Set((doc.frontmatter.shared ?? []) as string[])];
    const parts = [doc.body.trim(), ...shared.map((id) => {
      const block = catalog.docs.find((d) => d.kind === 'shared' && d.name === id);
      if (!block) throw new Error(`Missing shared block: ${id}`);
      return block.body.trim();
    })];
    const referenceNames = (doc.frontmatter.reference ?? []) as string[];
    const references = [...new Set(referenceNames)].map((id) => {
      const reference = catalog.docs.find((d) => d.kind === 'reference' && d.name === id);
      if (!reference) throw new Error(`Missing reference: ${id}`);
      return { name: id, content: reference.body.trim() };
    });
    const prompt = [
      ...parts,
      '## Available references (read only when needed)',
      ...references.map((r) => `- ${r.name}: references/${r.name}.md (relative to this packet)`),
      '## Task', taskText.trim(),
    ].join('\n\n') + '\n';
    return { name, prompt, shared, references, tokens: countTextTokens(prompt),
      sha256: createHash('sha256').update(prompt).digest('hex') };
  });
  const hostPrompt = [
    '# Task', taskText.trim(), '# Workflow',
    'Read repository instructions. Inspect relevant code and callers before editing.',
    'Keep existing behavior except for the requested change. Do not launch extra agents automatically.',
    ...plan.requiredChecks,
    ...(agents.length ? ['A selected review packet is available. Review is a separate stage, not evidence that it has already run.'] : []),
  ].join('\n\n') + '\n';
  return { plan, hostPrompt, hostTokens: countTextTokens(hostPrompt), agents };
}

export function writeTaskPacket(packet: ReturnType<typeof prepareTask>, outputDir: string): void {
  // Exclusive creation prevents overwriting an existing task or editor directory.
  mkdirSync(outputDir);
  writeFileSync(join(outputDir, 'host.md'), packet.hostPrompt, { flag: 'wx' });
  if (packet.agents.length) mkdirSync(join(outputDir, 'references'));
  const writtenReferences = new Set<string>();
  for (const agent of packet.agents) {
    writeFileSync(join(outputDir, `${agent.name}.md`), agent.prompt, { flag: 'wx' });
    for (const reference of agent.references) {
      if (writtenReferences.has(reference.name)) continue;
      writeFileSync(join(outputDir, 'references', `${reference.name}.md`), reference.content, { flag: 'wx' });
      writtenReferences.add(reference.name);
    }
  }
  writeFileSync(join(outputDir, 'manifest.json'), JSON.stringify({
    schemaVersion: 'leanagents.packet.v1', executionStatus: 'not-run',
    plan: packet.plan, hostTokens: packet.hostTokens,
    tokenMeaning: 'Local tokenizer count of assembled text; not runtime usage.',
    agents: packet.agents.map(({ name, tokens, sha256, shared, references }) => ({
      name, tokens, sha256, shared, references: references.map((r) => r.name),
    })),
  }, null, 2) + '\n', { flag: 'wx' });
}
