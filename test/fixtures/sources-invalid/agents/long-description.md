---
name: long-description
description: This description is deliberately far too long because agent descriptions are loaded into context on every single session regardless of whether the agent is ever invoked, which means an inflated description is a permanent tax on the user token budget, and Claude Code specifically warns once the combined descriptions of all subagents pass fifteen thousand tokens, so the schema has to reject this before it reaches a harness.
---

Body text so the empty-body rule does not also fire here.
