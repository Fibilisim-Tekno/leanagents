# LeanAgents

**Load only the expertise your coding task actually needs.**

[![CI](https://github.com/Fibilisim-Tekno/leanagents/actions/workflows/ci.yml/badge.svg)](https://github.com/Fibilisim-Tekno/leanagents/actions/workflows/ci.yml)

**Active development · v0.1.0-alpha.2 · MIT**

LeanAgents is a selective coding workflow for AI coding assistants. It uses explicit task scope and risk to load only the instructions, references and review steps a task actually needs.

The current alpha includes a TypeScript reviewer, bounded fix workflow, context preparation, routing and target-specific exports. Codex is the only runtime currently exercised with a real CLI; Kiro, Cursor and Antigravity exports are format-verified but not yet validated in native editor runs.

## Why LeanAgents?

- **Selective by default:** simple work stays with the host; extra review is added only when needed.
- **Context on demand:** shared instructions are assembled once; longer references stay separate until selected.
- **Verification before apply:** candidate fixes are tested and reviewed before they can be applied.
- **Recorded evidence:** source hashes, usage records and run results are kept for bounded workflows.
- **Quality before prompt size:** safety and correctness requirements are not silently removed to shrink context.

## Current support

| Capability | Status | Notes |
| --- | --- | --- |
| Task routing | ✅ Implemented | Explicit scope and risk produce the plan |
| Context preparation | ✅ Implemented | Selected instructions plus manifest and hashes |
| TypeScript review | ✅ Codex CLI tested | Explicit files reviewed through an authenticated Codex CLI |
| Bounded TypeScript fix | ✅ Implemented | Candidate → tests → separate review → guarded apply |
| Codex export | ✅ Bootstrap verified | Real CLI bootstrap loading checked |
| Kiro export | 🟡 Format verified | Native execution not yet verified |
| Cursor export | 🟡 Format verified | Native execution not yet verified |
| Antigravity export | 🟡 Format verified | Native execution not yet verified |
| Additional specialist agents | ⏳ Planned | Added only when measured failures justify them |

See [adapter support and activation](docs/ADAPTERS.md).

## Quick start

Runtime: Node.js 22.12+. Development: Node.js 22.13+ or 24+.

Run inside your project (no clone or build required):

```bash
npx @fibilisim/leanagents setup --target codex
```

Replace `codex` with `kiro`, `cursor`, or `antigravity`. Omit `--target` for
an editor selection menu. Use `--dry-run` to preview or `--dir` for another project.
Setup preserves existing Codex instructions with a marked block and backup.
Conflicting files stop setup before writes. Repeating setup does not duplicate it.

Published on npm as [`@fibilisim/leanagents`](https://www.npmjs.com/package/@fibilisim/leanagents).
Run `npx @fibilisim/leanagents setup` for the interactive editor menu.
Antigravity setup writes an Always On workspace rule (`trigger: always_on`); no manual activation is required for new installations. Native agent execution remains unverified.

### Development from source

```bash
git clone https://github.com/Fibilisim-Tekno/leanagents.git
cd leanagents
npm ci
npm run build
node dist/bin.js --help
node dist/bin.js check
```

Offline commands do not call a model. Review and fix commands use the installed Codex CLI and consume the authenticated account's quota.

### Export for Codex

```bash
node dist/bin.js export --target codex --out ../leanagents-codex
```

Other generated bundles:

```bash
node dist/bin.js export --target kiro --out ../leanagents-kiro
node dist/bin.js export --target cursor --out ../leanagents-cursor
node dist/bin.js export --target antigravity --out ../leanagents-antigravity
```

The destination must be new. Existing editor settings are never overwritten.

### Try a bounded fix

The supplied example intentionally contains a defect.

```bash
node dist/bin.js fix --repo examples/batch-fix --spec examples/batch-fix/task.json --out ../leanagents-run --model YOUR_MODEL_ID
node dist/bin.js apply --repo examples/batch-fix --run ../leanagents-run
```

On Windows, `--codex-js` can point to the installed Codex CLI JavaScript entrypoint. The fix command preserves original files; apply is a separate modification step. See [workflow constraints and instructions](docs/FIX-WORKFLOW.md).

## Core workflow

1. **Route** — build a selection plan from explicit task facts and risk.
2. **Prepare** — assemble the selected instructions, references and manifest.
3. **Review or fix** — use the bounded Codex-backed workflow for explicit TypeScript files.
4. **Verify** — run the supplied tests and obtain a separate review where required.
5. **Apply** — re-check source hashes before modifying the working copy.

## Verification

- 173 local tests pass together with type checking, lint and compilation.
- GitHub Actions checks Ubuntu and Windows on Node 22 and 24.
- A constructed reviewer smoke test found a known TypeScript defect and produced no finding after the host-side correction.
- A constructed bounded-fix smoke test moved from two failing tests to 3/3 passing, then passed a separate review and guarded apply.
- Codex bootstrap loading was checked with the real CLI.

These results demonstrate integration behavior. They do not establish general quality, lower total model usage, or superiority over ECC or another toolkit.

## Evaluation evidence

| Document | Purpose |
| --- | --- |
| [Evaluation methodology](bench/METHODOLOGY.md) | Defines fair comparison, held-out-task, usage-accounting and scoring rules |
| [Initial instruction-only pilot](bench/PILOT-2026-09-14.md) | Small three-arm prompt-only pilot; not a full workflow benchmark |
| [Reviewer smoke test](bench/SNAPSHOT-SMOKE-2026-09-14.md) | Known-defect review integration using the Codex CLI |
| [Automatic fix smoke test](bench/FIX-SMOKE-2026-09-14.md) | Candidate generation, tests, separate review and guarded apply |

## Scope and limits

The current fix runner supports explicit, dependency-free TypeScript snapshots. LeanAgents is not yet a general autonomous repository editor. Test programs execute locally; the working copy is not an operating-system sandbox. The reviewer can miss defects, and passing supplied tests proves only those tested behaviors.

Catalog size, assembled instruction size and actual model usage are different measurements. Cached input is not added twice. Smaller startup text is not, by itself, evidence of lower total cost or better code.

## Roadmap

1. Validate native editor workflows and context loading in Kiro, Cursor and Antigravity.
2. Evaluate held-out tasks with comparable model and tool settings.
3. Extend language and specialist coverage only where measured failures justify it.
4. Improve installation, recovery, packaging and release ergonomics.

## Development

```bash
npm run check:all
npm run build
node dist/bin.js check
```

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), [CHANGELOG.md](CHANGELOG.md) and the [`bench/`](bench/) directory. Licensed under [MIT](LICENSE).

<!-- ci-trigger: 2026-09-14 -->
