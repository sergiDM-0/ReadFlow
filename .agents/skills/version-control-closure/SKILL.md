---
name: version-control-closure
description: Execute pre-commit quality and bundle-size gates, audit git staging hygiene, and create atomic Conventional Commits as the mandatory final phase of every task after doc-sync-closure.
---

# Version Control Closure (Phase 2 of Task Closure)

Every completed task in this repository terminates with a two-phase closure pipeline:

1. **`doc-sync-closure`** (synchronizes JSDoc/TypeDoc, `CHANGELOG.md`, `README.md`, and version metadata)
2. **`version-control-closure`** (this skill — verifies quality gates, audits Git staging hygiene, and records atomic Conventional Commits)

This skill connects the feedback from `verification-loop`, `code-reviewer`, and `conventional-commit-review` into a single non-redundant final gate so no unformatted doc edit, broken test, oversized bundle, or untracked private artifact ever enters Git history.

## When to Activate

- Automatically as the **final step** of every feature, bug fix, refactor, or documentation update, immediately after `doc-sync-closure` finishes.
- Before creating any Git commit, tag, or pull request.

## Step-by-Step Closure Workflow

### Step 1: Delta-Aware Quality & Bundle Gate

Incorporate prior verification feedback from the session without blind redundancy, while guaranteeing that edits made during `doc-sync-closure` (such as `README.md`, `CHANGELOG.md`, `package.json`, or `manifest.*.json`) leave the tree 100% green:

1. **If only Markdown/JSON documentation files changed since the last full green test + build run**:
   - Run formatting check across the repo (to catch Markdown/JSON formatting from `doc-sync-closure`):
     ```bash
     npm run format:check
     ```
     _(If formatting fails, run `npm run format` and re-verify with `npm run format:check`)._
   - If `manifest.*.json` or `package.json` was updated during `doc-sync-closure`, also run `npm run build && npm run check:size` so `dist/` and bundle budgets reflect the updated manifests.
2. **If any code or test file under `src/`, `tests/`, or `scripts/` changed since the last verification run**:
   - Execute the full 6-gate verification pipeline:
     ```bash
     npm run format:check
     npm run typecheck
     npm run lint
     npm run test:coverage
     npm run build
     npm run check:size
     ```
   - **Hard Pass Criteria**:
     - `format:check`, `typecheck`, and `lint` exit with `0` errors.
     - `test:coverage` passes all unit/integration suites with **>= 80%** statements, branches, functions, and lines.
     - `check:size` confirms both Chrome and Firefox injected UI + Popup bundles are **< 200 KB**.

### Step 2: Staging Hygiene & Security Audit

Before staging or committing, inspect the working tree:

```bash
git status --short
git diff --stat
```

Verify all of the following guards:

- **No private or build artifact leaks**: Confirm `docs-private/`, `Documents/`, `dist/`, `coverage/`, and `node_modules/` remain untracked/ignored. Never use `git add -f` on ignored paths.
- **No secrets or debug residue**: Confirm no hardcoded tokens/keys, stray `console.log` statements in `src/` (only `src/shared/logger.ts` handles structured logging), or temporary scratch files exist in the diff.
- **Review feedback closed**: Confirm all `CRITICAL` and `HIGH` findings from `code-reviewer` (or `security-reviewer`) during the task have been resolved and verified by tests.

### Step 3: History-Aligned Conventional Commit Execution

Follow `conventional-commit-review` and `.agents/rules/common-git-workflow.md` to craft and execute the commit(s):

1. **Inspect recent repository commit norms**:
   ```bash
   git log --no-merges --format=%s -10
   ```
2. **Stage logically cohesive changes**:
   - Prefer explicit file staging (`git add <paths...>`) over blind `git add .` so only verified source, test, config, and canonical doc files are included.
   - Split unrelated functional changes into separate atomic commits if multiple independent requests were completed, or group a cohesive feature/fix together with its tests and `doc-sync-closure` documentation updates when they belong to one release unit.
3. **Commit using Conventional Commits format**:
   ```text
   <type>(<optional-scope>): <imperative summary under 72 chars>

   <optional concise body explaining what & why>
   ```
   - Allowed types: `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `chore`, `ci`.
   - No `Co-Authored-By` trailer unless explicitly requested by the user.
4. **Post-Commit Verification**:
   - Run `git status --short` and `git log -1 --stat` to confirm a clean working tree and accurate commit record.
   - **Remote push policy**: Only run `git push` when the user explicitly requests pushing to the remote repository.

## Anti-Patterns to Avoid

- **Committing before `doc-sync-closure`**: Never run `version-control-closure` without running `doc-sync-closure` first; doing so forces follow-up "oops, forgot to update CHANGELOG/README" commits.
- **Skipping `format:check` after doc edits**: Markdown edits in `README.md` or `CHANGELOG.md` often fail Prettier checks if committed without `npm run format:check`.
- **Blind `git add -A` with untracked scratch files**: Always review `git status --short` first and stage explicit paths.
- **Unrequested `git push` or destructive git flags**: Never run `--force`, `--no-verify`, or `git push` unless explicitly instructed by the user.

## Related Skills

- `doc-sync-closure` — Mandatory Phase 1 skill that must complete immediately before this skill.
- `conventional-commit-review` — Detailed guidance for commit type, scope, and subject line crafting.
- `verification-loop` — Underlying verification gate methodology.
