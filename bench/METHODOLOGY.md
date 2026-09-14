# Benchmark contract

## Two distinct experiments

A prompt-only pilot holds code inline and disallows tools. It compares reviewer
instructions under the same host. It cannot establish routing, reference-loading,
file-reading, multi-agent or whole-ECC efficiency. Providing LeanAgents' reference
in full is conservative for instruction size, but removes its on-demand behavior.

A workflow benchmark must run actual review tasks with equivalent tools, a pinned
model/effort, isolated clean workspaces and the same baseline commit. Record which
rules and agents load, rather than summing the installation directory. Pin prompt
hashes, tool versions, order, task code and all execution parameters before running.

## Independence

The current fixtures are development data, not a held-out test set. Reviewers must
not receive expected.json or scorer keywords. Use separate evaluation code that was
not used to write/tune prompts; freeze it before runs. New prompt revisions require
a fresh hold-out. Self-reported benchmark results are not independent replication.

## Usage

Save raw runtime events, failures, elapsed time and outputs for every attempt.
Input tokens include cached input; reasoning tokens may be a subset of output.
Never add these twice. Report components separately and state the provider's
accounting convention. No measured field means unknown, not zero. Cached-input
variation precludes treating aggregate token counts as monetary cost. Runtime
system context can vary even when the user prompt is unchanged.

## Correctness

The existing keyword scorer is a heuristic, not ground truth. It searches the
whole output and matches line mentions separately: unrelated paragraphs or a
negated finding can satisfy a defect. Its false-positive list is incomplete and
its precision/F1 fields are proxies. Severity-summary tags can also distort the
reported finding count. Do not publish those metrics as independently verified
quality. Review findings with arm names hidden and store adjudication separately.

Before formal scoring, audit expected defects for a concrete contract and
reproducer. For example, float-money-totals needs a demonstrated material rounding
failure/required money contract before every use of floating point is labelled a
high-severity miss. Missing parseInt radix alone is not the demonstrated NaN bug;
invalid-input handling is. Preserve the original fixture during the pilot rather
than changing the answer key to improve a candidate's score.

## Decision

At least three attempts per arm/task; report per-task data and variability, not
only one mean. One toy example cannot establish equal quality or superiority.
Compare against a plain-model arm too. A reviewer that costs less than ECC but
adds nothing over the plain model has not established its value yet. Select the
next scope only after quality and total usage are jointly evaluated.
