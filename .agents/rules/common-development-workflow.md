---
trigger: always_on
---

# Development Workflow

> This file extends [common/git-workflow.md](common-git-workflow.md) with the full feature development process that happens before git operations.

The Feature Implementation Workflow describes the development pipeline: research, planning, TDD, code review, mandatory documentation synchronization (`doc-sync-closure`), and version control closure (`version-control-closure`).

## Feature Implementation Workflow

0. **Research & Reuse** _(mandatory before any new implementation)_
   - **GitHub code search first:** Run `gh search repos` and `gh search code` to find existing implementations, templates, and patterns before writing anything new.
   - **Library docs second:** Use Context7 or primary vendor docs to confirm API behavior, package usage, and version-specific details before implementing.
   - **Exa only when the first two are insufficient:** Use Exa for broader web research or discovery after GitHub search and primary docs.
   - **Check package registries:** Search npm, PyPI, crates.io, and other registries before writing utility code. Prefer battle-tested libraries over hand-rolled solutions.
   - **Search for adaptable implementations:** Look for open-source projects that solve 80%+ of the problem and can be forked, ported, or wrapped.
   - Prefer adopting or porting a proven approach over writing net-new code when it meets the requirement.

1. **Plan First**
   - Use **planner** agent to create implementation plan
   - Generate planning docs before coding: PRD, architecture, system_design, tech_doc, task_list
   - Identify dependencies and risks
   - Break down into phases

2. **TDD Approach**
   - Use **tdd-guide** agent
   - Write tests first (RED)
   - Implement to pass tests (GREEN)
   - Refactor (IMPROVE)
   - Verify 80%+ coverage

3. **Code Review**
   - Use **code-reviewer** agent immediately after writing code
   - Address CRITICAL and HIGH issues
   - Fix MEDIUM issues when possible

4. **Documentation Closure (`doc-sync-closure` skill)** _(mandatory Phase 1 of task closure)_
   - Every completed feature, fix, refactor, or change MUST execute [doc-sync-closure](../skills/doc-sync-closure/SKILL.md) immediately after code review and **before** version control closure.
   - Apply fast-path diff triage: skip redundant doc churn for strictly internal/test-only edits; otherwise synchronize only the affected canonical sources (`CHANGELOG.md`, `README.md`, `CONTRIBUTING.md`, `typedoc.json`, JSDoc `/** ... */` on exported `src/` symbols, and synchronized `version` strings in `package.json` / `manifest.*.json`).
   - Run `npm run docs:api` when `src/` exports or `typedoc.json` change, and never create duplicate summary files or track gitignored `docs-private/` / `Documents/`.

5. **Version Control Closure (`version-control-closure` skill)** _(mandatory Phase 2 of task closure)_
   - Immediately after `doc-sync-closure`, execute [version-control-closure](../skills/version-control-closure/SKILL.md) as the terminal step of the workflow.
   - Run delta-aware verification gates (`npm run format:check`, `npm run typecheck`, `npm run lint`, `npm run test:coverage` >= 80%, `npm run build`, `npm run check:size` < 200 KB) without repeating heavy steps unnecessarily if only Markdown changed and Prettier passes.
   - Audit `git status --short` and `git diff` for staging hygiene (no private docs, build artifacts, secrets, or stray `console.log`), then record atomic Conventional Commits aligned with [git-workflow.md](common-git-workflow.md).

6. **Pre-Review / PR Checks**
   - Verify all automated checks (CI/CD) are passing
   - Resolve any merge conflicts
   - Ensure branch is up to date with target branch
   - Only push or request PR review when explicitly requested and after all checks pass
