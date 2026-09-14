# Editor instruction adapters

Checked against official documentation on 2026-09-14. These bundles provide
host instructions, not native subagent registration. Only the small routing
bootstrap is configured for initial loading; reviewer and references are plain
files to read when relevant. Selection by the host is guidance, not enforcement.

| Target | Bootstrap | Activation | Verification |
| --- | --- | --- | --- |
| Codex | AGENTS.md | Project instructions | Generated format and actual CLI bootstrap loading |
| Kiro | .kiro/steering/leanagents.md | inclusion: always | Generated format only |
| Cursor | .cursor/rules/leanagents.mdc | alwaysApply: true | Generated format only |
| Antigravity | .agents/rules/leanagents.md | `trigger: always_on` | Format tested; installed rule-editor parser inspected; native execution unverified |

Run `leanagents export --target codex --out new-bundle` (or another target).
The directory must not exist. It contains the native bootstrap, reviewer,
reference and a manifest with source links, content hashes and local token counts.
No editor settings or existing instruction files are overwritten.

Startup text counts are included in each export manifest. These are
local tokenizer counts of generated bootstrap files, not billed usage. They do
not include the host's own instructions, other project rules or later reads.
Existing ECC instructions are not removed by exporting LeanAgents.

A Codex CLI 0.153.4 invocation from the exported directory correctly described
the documentation-only route, reviewer path and one-reviewer limit without
tools. This validates bootstrap discovery only, not subsequent reviewer reads
or independent delegation. No equivalent native Kiro/Cursor/Antigravity run
has been completed. The installed Kiro and Cursor launchers are desktop tools;
their presence is not proof of headless agent support.

Official sources:

- [Codex instruction discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md).
  An existing AGENTS.override.md can supersede AGENTS.md. Do not overwrite it.
- [Kiro steering](https://kiro.dev/docs/steering/).
  Custom agents require explicit resources; normal workspace steering is not
  automatically inherited by them.
- [Cursor rules](https://cursor.com/docs/rules).
  The `.mdc` format and alwaysApply metadata determine loading.
- [Antigravity rules](https://antigravity.google/docs/rules-workflows).
  The current directory is `.agents/rules`; legacy `.agent/rules` remains
  supported. The installed Antigravity IDE rule editor (VS Code base 1.107.0,
  inspected 2026-09-14) parses `trigger: always_on` and exposes it as Always On.
  The exporter writes this explicit metadata. This verifies the rule format,
  not end-to-end native agent execution.

## Setup and upgrades

Run `npx @fibilisim/leanagents setup --target antigravity` inside your project.
Only the small routing rule is Always On; the reviewer is read when relevant.
Existing differing files are preserved and stop setup. For an older plain
Antigravity rule, add `---`, `trigger: always_on`, `---` as its YAML header
without replacing customized content.
