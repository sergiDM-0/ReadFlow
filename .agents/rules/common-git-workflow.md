---
trigger: always_on
---

# Git Workflow

## Commit Message Format

```
<type>: <description>

<optional body>
```

Types: feat, fix, refactor, docs, test, chore, perf, ci

Note: ECC-managed installs set `"includeCoAuthoredBy": false` in `~/.claude/settings.json`, so commits carry no `Co-Authored-By` trailer by default. To keep Claude attribution, set `"includeCoAuthoredBy": true` or configure `attribution`; ECC never overwrites an explicit choice.

## Mandatory Sequential Task Closure Pipeline

Every completed task MUST terminate with these two skills in strict order (without skipping or reversing them):

1. **[doc-sync-closure](../skills/doc-sync-closure/SKILL.md)** _(first)_: Synchronize JSDoc/TypeDoc (`npm run docs:api`), `CHANGELOG.md`, `README.md`, `CONTRIBUTING.md`, and version metadata (`package.json`, `manifest.*.json`) with zero duplicate files, respecting `living-docs-governance` and keeping `docs-private/` and `Documents/` untracked.
2. **[version-control-closure](../skills/version-control-closure/SKILL.md)** _(second)_: Verify quality and bundle-size gates (`format:check`, `typecheck`, `lint`, `test:coverage` >= 80%, `build`, `check:size` < 200 KB), audit `git status --short` / `git diff` hygiene, and create atomic Conventional Commits aligned with `conventional-commit-review`. Only run `git push` when explicitly requested by the user.

## Pull Request Workflow

When creating PRs:

1. Analyze full commit history (not just latest commit)
2. Use `git diff [base-branch]...HEAD` to see all changes
3. Draft comprehensive PR summary
4. Include test plan with TODOs
5. Push with `-u` flag if new branch

> For the full development process (planning, TDD, code review, documentation closure, and version control closure) before git operations,
> see [development-workflow.md](common-development-workflow.md).
