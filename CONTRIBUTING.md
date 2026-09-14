# Contributing

LeanAgents is in active alpha development. Focused bug reports, reproducible
failures and small changes with clear evidence are welcome.

Use Node.js 22.13+ or 24+. Run `npm ci`, `npm run check:all`, `npm run build`
and `node dist/bin.js check` before submitting a change.

Describe the failing behavior, expected behavior and relevant verification.
Keep changes scoped. Do not change benchmark answer keys simply to improve a
score. New instructions should address a demonstrated failure rather than add
speculative specialist coverage. Keep runtime usage distinct from text counts.

Do not commit credentials, private prompts, local run directories or generated
editor configurations. See SECURITY.md for private vulnerability reporting.
