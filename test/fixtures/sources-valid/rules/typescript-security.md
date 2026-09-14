---
name: typescript-security
description: Security constraints applied to TypeScript and JavaScript files whenever one of them is in context.
scope: typescript
category: security
globs:
  - '**/*.ts'
  - '**/*.tsx'
---

Use parameterized queries. Never build SQL with string concatenation.

Validate external input at the boundary, then trust it inward.
