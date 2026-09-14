---
name: missing-shared
description: References a shared block that does not exist, which would silently drop content during the build step.
shared:
  - does-not-exist
---

Body text so the empty-body rule does not also fire here.
