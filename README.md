# LeanAgents

Selective coding workflows with explicit context budgets.

**Active development · v0.1.0-alpha.1 · MIT**

LeanAgents explores a practical question: can a coding workflow use only the
instructions and review steps a task needs while preserving useful verification?
It combines a small instruction catalog, task routing, bounded TypeScript fixes,
and recorded test and review results.

This is an alpha release. The TypeScript reviewer and bounded fix workflow are
implemented. Additional specialist agents and broader runtime integrations are
planned. Lower instruction size is not proof of lower total usage or better code.

## Available today

- **Task routing:** explicit scope and risk determine whether a reviewer is needed.
  Simple, low-risk documentation work stays with the host.
- **Selected context:** shared instructions are assembled once per packet;
  longer references remain separate until needed.
- **TypeScript review:** review explicitly selected source files through an
  already authenticated Codex CLI, with source hashes and usage records.
- **Bounded fixes:** generate a candidate, run immutable Node tests, obtain one
  separate review, and apply only if the recorded source files are unchanged.
- **Editor bundles:** export instructions for Codex, Kiro, Cursor and Antigravity.
  These are instruction bundles, not native subagent registrations.
- **Offline tooling:** validate the catalog, check token budgets, and score saved
  review outputs against fixtures.

## Quick start

Runtime: Node.js 22.12+. Development: Node.js 22.13+ or 24+.
Install from source; this release does not imply an npm registry publication.

```bash
git clone https://github.com/Fibilisim-Tekno/leanagents.git
cd leanagents
npm ci
npm run build
node dist/bin.js --help
node dist/bin.js check
```

Offline commands do not call a model. Review and fix commands use the installed
Codex CLI and consume the authenticated account's quota.

### Export a Codex instruction bundle

```bash
node dist/bin.js export --target codex --out ../leanagents-codex
```

The destination must be new. Existing editor settings are never overwritten.
Codex bootstrap loading has been checked with the real CLI. Other editor bundles
are also available; their current verification is limited to generated formats:

```bash
node dist/bin.js export --target kiro --out ../leanagents-kiro
node dist/bin.js export --target cursor --out ../leanagents-cursor
node dist/bin.js export --target antigravity --out ../leanagents-antigravity
```

See [adapter support and activation](docs/ADAPTERS.md).

### Try a bounded fix

The supplied example intentionally contains a defect.

```bash
node dist/bin.js fix --repo examples/batch-fix --spec examples/batch-fix/task.json --out ../leanagents-run --model YOUR_MODEL_ID
node dist/bin.js apply --repo examples/batch-fix --run ../leanagents-run
```

On Windows, `--codex-js` can point to the installed Codex CLI JavaScript entrypoint.
The fix command preserves original files; apply is the separate modification step.
See [workflow constraints and instructions](docs/FIX-WORKFLOW.md).

## Verification and limits

- 169 local tests pass, alongside type checking, lint and compilation.
- In a constructed smoke test, the automatic fix changed a failing implementation
  into one passing all three supplied tests; a separate reviewer approved it.
- Codex bootstrap loading was checked with the real CLI. Kiro, Cursor and
  Antigravity exports have format tests; native execution remains unverified.
- The GitHub Actions workflow checks Windows/Linux and Node 22/24. Remote results
  are available in the repository's Actions tab once the workflow runs.

The current fix runner supports explicit, dependency-free TypeScript snapshots.
It is not a general autonomous repository editor. Test programs execute locally;
the working copy is not an operating-system sandbox. Use trusted code and tests.
The reviewer can miss defects. Test results cover the supplied tests only.

## Measurement policy

Catalog size, assembled instruction size and actual model usage are different
measurements. Cached input is not added twice. Offline keyword scoring is a
heuristic, not an independent quality assessment. No superiority over ECC or
other toolkits is claimed.

- [Evaluation methodology](bench/METHODOLOGY.md)
- [Initial instruction-only pilot](bench/PILOT-2026-09-14.md)
- [Reviewer smoke test](bench/SNAPSHOT-SMOKE-2026-09-14.md)
- [Automatic fix smoke test](bench/FIX-SMOKE-2026-09-14.md)

These small experiments demonstrate integration behavior, not general quality
or token savings across real projects.

## Roadmap

1. Validate native editor workflows and context loading.
2. Evaluate held-out tasks with comparable model and tool settings.
3. Extend language and specialist coverage only where measured failures justify it.
4. Improve installation, recovery and workflow ergonomics.

## Development

```bash
npm run check:all
npm run build
node dist/bin.js check
```

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and
[CHANGELOG.md](CHANGELOG.md). Licensed under [MIT](LICENSE).
