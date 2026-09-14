---
name: typescript-review-details
description: Deep TypeScript review detail that the reviewer agent reads only when it needs concrete examples.
scope: typescript
---

## Narrowing

A preceding `if (x == null) return;` narrows the type. Do not flag the later
access as a possible null dereference.
