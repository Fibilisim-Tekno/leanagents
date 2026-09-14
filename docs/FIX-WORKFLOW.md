# Bounded automatic fixes

`fix` uses the existing authenticated Codex CLI for one implementation call,
then runs supplied Node tests and makes at most one separate reviewer call.
It does not start a planner/developer/tester agent chain or retry indefinitely.
The default model transport remains read-only and tool-free; the host constructs
candidate files from validated JSON. Account quota is consumed by model calls.

```bash
leanagents fix --repo examples/batch-fix --spec examples/batch-fix/task.json --out new-run --model MODEL_ID
leanagents apply --repo examples/batch-fix --run new-run
```

On Windows add `--codex-js` to `fix` when the installed CLI is a shell shim.
The output parent directory must exist and `new-run` must not exist.
The example deliberately contains a defect; applying fixes changes the example.

The specification contains explicit task facts, request, all source paths,
editable paths and test paths. Paths are canonical relative paths using `/`.
Only dependency-free TypeScript supported by Node type stripping is currently
supported. Node built-in tests must be supplied in the snapshot. No dependency
installation, framework build, whole-repository clone or test generation occurs.
No new files or deletions are proposed; only selected existing source files.

The model cannot change selected tests. Run artifacts include original source
contents, prompts, patches, model usage, baseline results, candidate results and
the review. Do not publish private run directories inadvertently. Tests and
candidate code execute as local Node programs with the current user's access:
the isolated copy is not an OS security sandbox. Use trusted repositories/tests.

Success means the explicit tests passed without skipped/cancelled/todo cases,
source content stayed unchanged during checks, and a fresh reviewer approved.
It is finite evidence, not a guarantee that the implementation has no defects.
The baseline is recorded, not required to fail. Missing imports, unsupported
runtime syntax, absent tests and timeouts stop before any model call. Other
baseline failures may still require diagnosis. Missing/invalid model output
fails closed.

`candidate-verified` leaves the original repository untouched. The separate
`apply` command rechecks candidate content, reruns tests, checks the approving
review and compares all original files to the recorded snapshot. Stale originals
or changed candidates stop application. Selected replacements use temporary
files and rename; on a write failure, already replaced files are restored when
they still match the generated content. Simultaneous editing is not supported;
there is no global filesystem transaction. Backups remain in original.json.

`applied.json` records the selected files and checks. Tests pass in the isolated
candidate, not necessarily in a larger application with omitted dependencies.
Publishing, commits and pushes are outside this command.
