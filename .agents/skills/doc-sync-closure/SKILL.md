---
name: doc-sync-closure
description: Synchronize canonical project documentation (CHANGELOG.md, README.md, CONTRIBUTING.md, typedoc.json, and JSDoc/TypeDoc API docs) as the mandatory first closing phase of every completed change without creating redundant files.
---

# Documentation Sync Closure (Phase 1 of Task Closure)

Every non-trivial code, feature, fix, or configuration change in this repository must close through a two-phase pipeline:

1. **`doc-sync-closure`** (this skill — documentation & API contract synchronization)
2. **`version-control-closure`** (quality gates, staging audit, and Conventional Commit)

This skill complements `living-docs-governance` by translating its "one canonical owner per fact" rule into a concrete, zero-redundancy checklist tailored to this repository's documentation surface and feedback loops.

## When to Activate

- Automatically at the end of **every** feature, bug fix, refactor, performance optimization, or build/manifest change, immediately after code implementation and review (`code-reviewer`) and **before** running `version-control-closure`.
- Whenever exported symbols in `src/`, scripts in `package.json`, browser permissions/matches in `manifest.*.json`, or bundle metrics from `npm run check:size` change.

## Canonical Documentation Ownership Map

Never create parallel summary files (`NOTES.md`, `SUMMARY.md`, `DOCS_UPDATE.md`, etc.). Every fact belongs in exactly one canonical file:

| Canonical File                                                  | Single Source of Truth For                                                                           | When to Update                                                                                         |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/**/*.ts` (JSDoc `/** ... */`)                              | Public class, interface, type, and function contracts                                                | Whenever an exported symbol is added or its signature/behavior changes                                 |
| `typedoc.json`                                                  | Entry points for automated API reference generation (`npm run docs:api`)                             | Whenever a new `src/` module is created, renamed, or deleted                                           |
| `CHANGELOG.md`                                                  | Chronological release history (`### Added`, `### Fixed`, `### Changed`, `### Performance`)           | On any user-visible feature, bug fix, UX improvement, or architectural/performance milestone           |
| `README.md`                                                     | Product features, `src/` directory map, installation/build instructions, and UI bundle size badge    | When user-facing capabilities, source file structure, commands, or `npm run check:size` metrics change |
| `CONTRIBUTING.md`                                               | Development workflow, quality gates, and extension guides (adding a TTS engine, adding a UI setting) | Only when developer scripts, quality thresholds, or architectural extension points change              |
| `package.json`, `manifest.chrome.json`, `manifest.firefox.json` | Semantic version (`version` field)                                                                   | When cutting or bumping a release entry in `CHANGELOG.md` (all three must stay identical)              |

> **Isolation Rule**: `docs-private/` (including `docs-private/typedoc-api/`) and `Documents/` are gitignored local/private directories. Never track them in Git or duplicate their contents into tracked Markdown files.

## Step-by-Step Closure Workflow

### Step 1: Fast-Path Diff Triage (Avoid Redundant Churn)

Inspect `git status --short` and `git diff` to classify the change:

- **Internal-only fast-path**: If the change only touches unit/integration test internals, private helper implementation details, or code formatting with **no** change to user-visible behavior, exported symbols, file structure, or bundle size, skip file edits in Step 3 and proceed directly to `version-control-closure`.
- **User-facing or structural change**: Continue with Steps 2–4.

### Step 2: Code-Level JSDoc & TypeDoc Verification

1. Verify every new or modified `export` in `src/` has a concise, accurate JSDoc comment (`/** ... */`) describing purpose, parameters, and return or error behavior.
2. If any file under `src/` was added, moved, or removed, update the `entryPoints` array in `typedoc.json` so it matches the live module tree.
3. If `typedoc` is installed locally (`node_modules/.bin/typedoc`), run TypeDoc generation to confirm zero broken links or missing export types (otherwise validate all JSDoc/types via `npm run typecheck`):
   ```bash
   test -x node_modules/.bin/typedoc && npm run docs:api || npm run typecheck
   ```
   _(When `typedoc` is present, outputs to gitignored `docs-private/typedoc-api/`; must exit with code `0`)._

### Step 3: Synchronize Canonical Markdown & Version Metadata

Update only the canonical sections affected by the current task:

1. **`CHANGELOG.md`**:
   - Group changes under the active version header (`## [X.Y.Z] — YYYY-MM-DD`) using standard Keep a Changelog categories (`### Added`, `### Fixed`, `### Changed`, `### Performance`).
   - Write concrete, evidence-backed bullets (name the modules, UI components, or browser capabilities affected).
   - If bumping the version, synchronize the `"version"` field across `package.json`, `manifest.chrome.json`, and `manifest.firefox.json`.
2. **`README.md`**:
   - Update feature tables/bullets if user-facing behavior changed (e.g., new selection surfaces, AutoReadDock behavior, playback fallbacks).
   - Update the `src/` architecture tree if files were added or responsibilities shifted.
   - If `npm run check:size` reported a new UI + Popup bundle size, update the size badge/metric in `README.md` so documentation reflects real build output.
3. **`CONTRIBUTING.md`**:
   - Update only if `package.json` scripts, architectural boundaries, or contributor workflows changed.

### Step 4: Handoff to `version-control-closure`

Once documentation files are updated and `npm run docs:api` passes:

- Do **not** stop or leave documentation unverified by Prettier.
- Immediately transition to the **`version-control-closure`** skill to run formatting/verification gates, audit staged files, and commit.

## Anti-Patterns to Avoid

- **Redundant prose**: Do not repeat full `CHANGELOG.md` release notes verbatim inside `README.md`; `README.md` describes _current_ capabilities, while `CHANGELOG.md` records _historical deltas_.
- **Orphaned modules in `typedoc.json`**: Never add a new `.ts` file under `src/` without registering it in `typedoc.json`.
- **Version drift**: Never bump `CHANGELOG.md` or `package.json` without keeping `manifest.chrome.json` and `manifest.firefox.json` at the exact same version string.
- **Private doc leakage**: Never force-add (`git add -f`) files inside `docs-private/` or `Documents/`.

## Related Skills

- `living-docs-governance` — Underlying 4-role documentation architecture principles.
- `version-control-closure` — Mandatory Phase 2 skill executed immediately after `doc-sync-closure`.
