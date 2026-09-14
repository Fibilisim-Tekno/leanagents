---
name: evidence-gate
description: The four conditions a finding must satisfy before it is reported, shared by every review agent so the bar is identical across languages.
---

## Evidence gate

Before writing a finding, satisfy all four. If any one fails, drop the finding
or lower its severity.

1. **Location.** Name the file and line. "Somewhere in the auth layer" is not a
   finding.
2. **Trigger.** Name the input, state or sequence that produces the bad
   outcome. If you cannot name one, you are pattern matching, not reviewing.
3. **Context.** You have read the callers, the types and any guard in scope.
   Many apparent defects are already handled one frame up.
4. **Consequence.** You can state what breaks and for whom.

For critical and high findings, also quote the exact snippet and say why the
existing types, validation or framework defaults do not already catch it. If
you cannot do that, it is not critical or high.
