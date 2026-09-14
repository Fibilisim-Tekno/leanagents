# Snapshot reviewer integration — 2026-09-14

Model: gpt-6-astra, low effort; installed Codex CLI 0.153.4, existing ChatGPT
authentication. Two calls, explicit single-file TypeScript snapshots, no tools.
This is a constructed smoke test with a known defect, not a held-out benchmark.

Contract: offset is the zero-based start; limit is the requested item count.
Original implementation: `items.slice(offset, limit)`.

| Observation | Original | After host fix |
| --- | --- | --- |
| Implementation | slice(offset, limit) | slice(offset, offset + limit) |
| Model finding | Count used as end index | No findings |
| CLI input tokens | 16,194 | 16,017 |
| Cached input tokens (included in input) | 11,776 | 11,776 |
| Output tokens | 198 | 44 |
| Completed tool events | 0 | 0 |
| Host assertion | Failed: [2] instead of [2,3,4] | Three assertions passed |

The host independently checked offset 2/count 3, zero count, and a range
extending past the array. The model did not perform the fix or run these tests.
The reviewer called the defect high severity; this smoke test does not validate
that severity calibration. There was no ECC comparator and no savings claim.

Local raw records are under the workspace outputs/leanagents-audit directory:
snapshot-review-v1 and snapshot-review-fixed-v1. These contain source hashes,
prompts, JSONL events and result.json. They are not distributed in the package.
The prompt was subsequently clarified to remove unavailable reference links;
the measured calls precede that wording clarification.
