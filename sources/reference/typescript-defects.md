---
name: typescript-defects
description: Concrete TypeScript and JavaScript defect patterns with the input that triggers each one. Loaded on demand, only after a reviewer has a specific suspicion.
scope: typescript
---

Each entry gives the trigger, not just the shape. If you cannot map a suspicion
onto a trigger here, you probably do not have a finding.

## Async

**Floating promise.** An async call whose promise is neither awaited nor
`.catch`ed. Trigger: the call rejects. Consequence: an unhandled rejection, and
in Node the process may exit. Detached calls are fine when deliberate; look for
`void` or a comment before flagging.

**Await inside a loop over a collection.** Trigger: the collection grows.
Consequence: latency multiplies by length. Only a defect when the iterations are
independent and the collection is unbounded; a sequential dependency is correct.

**Missing timeout on an outbound call.** Trigger: the remote hangs rather than
failing. Consequence: the caller hangs with it, and connections accumulate.

**`Promise.all` where one rejection loses the rest.** Trigger: one element
rejects. Consequence: successful work is discarded. Check whether
`allSettled` was intended.

## State and mutation

**Mutating an argument or shared object.** Trigger: a second caller reads the
same reference. Consequence: action at a distance, and the bug surfaces far from
the mutation.

**Mutating an array or object held in state.** Trigger: a framework compares by
reference to decide whether to re-render or recompute. Consequence: the update
is not observed.

## Types at boundaries

**`as` assertion on external data.** Trigger: the payload does not match.
Consequence: the type system reports safety it never verified, and the failure
appears later, somewhere unrelated. Parsing validates; assertion does not.

**Non-null assertion (`!`) on a value that can legitimately be absent.**
Trigger: the absent case. Consequence: a runtime throw where the type said it
could not happen.

**`any` at a module boundary.** Trigger: a caller passes something the callee
never handled. Consequence: every check downstream is disabled. Inside a
narrow local scope this is usually noise, not a defect.

## Data access

**String concatenation into a query, command or path.** Trigger: input
containing the delimiter. Consequence: injection, or escape from the intended
directory. Parameterise, or resolve and verify the path stays inside its root.

**Query in a loop over parent rows.** Trigger: more parents. Consequence: round
trips scale with rows. Not a defect for fixed small cardinality or where
batching is already in place.

**Unbounded read on a user-facing path.** Trigger: the table grows.
Consequence: memory and latency grow with it. Look for a missing limit rather
than a missing index.

## Error handling

**`catch` that logs and continues.** Trigger: the error is one the caller needed
to act on. Consequence: a corrupted or partial result treated as success. The
question is whether continuing is correct here, not whether the catch exists.

**Empty `catch`.** Trigger: any failure. Consequence: silence. A comment
explaining why the failure is ignorable makes this fine.

**Internal error detail returned to a client.** Trigger: any failure.
Consequence: stack traces, queries or paths become reconnaissance.

## Comparison and conversion

**`==` used deliberately for `null` or `undefined`.** Not a defect. `x == null`
covering both is idiomatic. Flag `==` only where a type coercion changes the
result.

**`parseInt` without a radix, or `Number` without a `NaN` check.** Trigger:
input like `"08"` or `"12abc"`. Consequence: a wrong number flows onward as
though valid.

**Floating point used for money.** Trigger: values that do not divide cleanly in
binary. Consequence: totals drift by fractions of a unit.

## React and hooks

**Effect dependency array missing a value the effect reads.** Trigger: that
value changes. Consequence: the effect keeps the first value, and the UI shows
stale data. An intentionally-once effect should say so in a comment.

**Array index as `key` in a reorderable list.** Trigger: reorder, insert or
delete. Consequence: state and DOM nodes attach to the wrong items. Index keys
are correct for append-only lists.

**State updated during render.** Trigger: the render path runs. Consequence: a
render loop.

**Handler capturing state from an earlier render.** Trigger: the handler runs
after a state change. Consequence: it acts on a value that is no longer true.
Reach for the updater form.

## Concurrency

**Read-then-write without atomicity.** Trigger: two requests interleave.
Consequence: one write is lost. Needs a transaction, a conditional update or a
lock.

**Cache written before the source of truth is confirmed.** Trigger: the write
fails after the cache is set. Consequence: the cache serves a value that never
persisted.
