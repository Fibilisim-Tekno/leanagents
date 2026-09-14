---
name: finding-format
description: The output shape every review agent uses, so findings stay comparable and machine-readable across languages and harnesses.
---

## Finding format

Report each finding in this shape, worst first:

```
[severity] one-line summary
file:line
Trigger: the input or state that causes it
Consequence: what breaks, and for whom
Fix: the smallest change that removes the cause
```

Collapse findings that share a single cause into one entry. Five call sites
missing the same guard is one finding with five locations, not five findings.

Close with one summary line: counts per severity, then the verdict.
