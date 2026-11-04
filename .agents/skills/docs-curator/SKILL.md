---
name: docs-curator
description: Audit and fix documentation across any repository. Spawns parallel agents to check README files, contribution guides, and project docs for outdated, missing, or inconsistent content. Works with any codebase structure.
user-invocable: true
---

# Documentation Curator

Audit and maintain documentation across any repository. Spawns parallel agents to inspect different documentation areas against the actual codebase, then presents a consolidated report for approval before making any changes.

## When to Use

- Documentation feels stale or out of sync with the code
- After significant refactors, new features, or dependency changes
- Adding or removing packages, modules, or services
- Periodic documentation health checks
- When you suspect README files are missing, incomplete, or contradictory
- Before a release to ensure docs match the shipped code

## Invocation

Full audit (all documentation):
```
/docs-curator
```

Scoped audit (specific file or area):
```
/docs-curator README.md
/docs-curator AGENTS.md
/docs-curator CONTRIBUTING.md
/docs-curator scripts
/docs-curator consistency
/docs-curator links
/docs-curator pack
/docs-curator prd
/docs-curator specs
/docs-curator issues
```

## What Gets Audited

The curator dynamically discovers documentation in the repository. It always checks for these common files, but adapts to whatever exists:

| File / Area | What's Checked |
|---|---|
| `README.md` (root) | Project description, install steps, usage examples, listed features, links |
| `README.md` (nested) | Sub-package or module READMEs in `packages/`, `libs/`, `apps/`, `src/`, etc. |
| `AGENTS.md` / `CLAUDE.md` / `GEMINI.md` | Agent instructions, skill references, project conventions, tooling rules |
| `CONTRIBUTING.md` | Contribution workflow, setup instructions, tooling references |
| `CHANGELOG.md` | Recent entries match actual changes |
| `docs/` directory | Any dedicated documentation folder |
| `scripts/` directory | Scripts exist, are documented, and references are valid |
| Config files | `pyproject.toml`, `package.json`, `Cargo.toml`, `Makefile`, etc. — cross-referenced against docs |

---

## Instructions

When this skill is invoked, follow this process exactly.

### Step 1: Discover the Repository Structure & Deterministic Tooling Pre-check

Before launching any audit agents, understand what you're working with:

1. Read the top-level directory listing to understand the project layout
2. Identify which documentation files exist (README.md, CONTRIBUTING.md, AGENTS.md, CLAUDE.md, GEMINI.md, docs/, etc.)
3. Identify the project type (Python, Node, Rust, monorepo, single package, etc.)
4. Identify configuration files (pyproject.toml, package.json, Cargo.toml, Makefile, etc.)
5. Note any agent/skill/plugin directories if present (.agents/, .claude/, .cursor/, etc.)

**Deterministic Tooling Pre-check (Fast & Ground-Truth)**:
- **Repomix Packaging**: When doing a holistic, monorepo, or cross-reference audit, run `repomix --include "**/*.md" --style xml -o .scratch/docs-repomix.xml` (or `--style markdown`) to aggregate all documentation files in one clean, token-efficient context. For code-to-doc verification, `repomix --summary` or targeting key source files gives instant architectural ground-truth without piecemeal directory navigation.
- **Link Verification**: Run `markdown-link-check` on target documentation files to deterministically flag broken URLs, relative links, and anchor tags. For Windows/pwsh, you can check individual files with `markdown-link-check README.md` or scan all documentation with `Get-ChildItem -Path . -Recurse -Filter *.md -Exclude node_modules,dist,build,.git | ForEach-Object { markdown-link-check $_.FullName }`. Use these deterministic results directly in the report rather than guessing link validity with LLM reasoning.
- **4-Ring Topology & Health Gate**: 针对本系统技术知识图谱，运行 `node .agents/skills/doc-architect/scripts/check-doc-health.js`（或 `pnpm run check:doc-health`），确定性校验 L1 配额、本地文档零死链、以及 L1~L4 异环严格单级相邻契约。

This discovery and tooling step determines which audit agents to launch and provides exact facts for verification.

### Step 2: Launch Parallel Audit Agents

Launch the relevant agents **in a single message** for parallel execution. Adapt the agent prompts below based on what you discovered in Step 1 — only include checks that are relevant to the repository.

#### Agent 1: Primary README Auditor

```
description: "Audit root README.md against the actual codebase"
prompt: |
  DOCUMENTATION AUDIT: Root README.md

  Read the root README.md and audit it against the actual codebase.

  DISCOVERY (read these first):
  - Top-level directory listing
  - Primary config file (pyproject.toml / package.json / Cargo.toml / etc.)
  - Source directory structure

  CHECK FOR:
  1. Project description — does it accurately describe what the code does?
  2. Installation instructions — do the commands work? Are dependencies correct?
  3. Usage examples — do they reflect the current API/CLI?
  4. Listed features/packages/modules — do they match what actually exists?
  5. Badges, links, and references — are URLs and paths valid? (Run `markdown-link-check README.md` to verify links deterministically)
  6. Prerequisites and version requirements — are they current?
  7. Any code snippets — do they use current syntax and imports?

  RESPONSE FORMAT:
  ## Accurate Content
  - [What is correct and up to date]

  ## Outdated or Incorrect Content
  - [Section/line]: [What's wrong] → [What it should say]

  ## Missing Content
  - [What should be added and why]

  ## Recommended Changes
  [Specific edits with section references]
```

#### Agent 2: Project Configuration & Guides Auditor

Adapt this agent to whatever configuration and guide files exist (CONTRIBUTING.md, AGENTS.md, CLAUDE.md, GEMINI.md, setup guides, etc.):

```
description: "Audit project guides and configuration documentation"
prompt: |
  DOCUMENTATION AUDIT: Project Guides & Configuration

  Audit all project guide files against the actual codebase.

  FILES TO CHECK (if they exist):
  - CONTRIBUTING.md
  - AGENTS.md / CLAUDE.md / GEMINI.md
  - CODE_OF_CONDUCT.md
  - docs/setup.md or similar setup guides
  - .github/PULL_REQUEST_TEMPLATE.md
  - Any AI coding agent/tool configs (.agents/, .claude/, .cursor/, .gemini/, etc.)

  FOR EACH FILE, CHECK:
  1. Referenced tools, commands, and scripts actually exist
  2. Setup/install instructions are accurate and complete
  3. Workflow descriptions match the actual project structure
  4. Listed features, agents, skills, or plugins match what's implemented
  5. Environment variables and configuration are current
  6. File paths and directory references are valid

  VERIFY AGAINST:
  - Actual directory structure
  - Config files (pyproject.toml, package.json, etc.)
  - Scripts directory contents
  - CI/CD configuration if present

  RESPONSE FORMAT:
  ## [Filename]
  ### Accurate Content
  - [What is correct]

  ### Outdated or Incorrect Content
  - [Section]: [What's wrong] → [What it should say]

  ### Missing Content
  - [What should be added]

  ## Recommended Changes
  [Specific edits per file with section references]
```

#### Agent 3: Scripts, Tooling & Infrastructure Auditor

```
description: "Audit scripts, tooling, and infrastructure documentation"
prompt: |
  DOCUMENTATION AUDIT: Scripts, Tooling & Infrastructure

  Audit the scripts/, tools/, and infrastructure directories for accuracy.

  CHECK THESE AREAS:
  1. List all files in scripts/ (and tools/, bin/, etc.) — verify each exists and is documented
  2. Check that documented scripts are functional (read them, verify paths and commands)
  3. Verify Makefile / Taskfile / justfile targets match documentation
  4. Check CI/CD configs (.github/workflows/, .gitlab-ci.yml, etc.) for consistency with docs
  5. Verify Docker/container files match documented setup instructions
  6. Check that no documentation references deleted or renamed files

  SEARCH FOR STALE REFERENCES:
  - Grep all .md files for references to scripts/ or tools/ paths
  - Flag any path that doesn't resolve to an actual file
  - Flag any script that exists but isn't mentioned in any documentation

  RESPONSE FORMAT:
  ## Scripts Directory
  ### Current contents: [list actual files found]
  ### Documented but missing: [files referenced in docs that don't exist]
  ### Exists but undocumented: [files that exist but aren't in any docs]

  ## Tooling & Infrastructure
  ### Accurate: [what's correct]
  ### Issues: [what needs fixing]

  ## Recommended Changes
  [Specific edits per file]
```

#### Agent 4: Cross-Reference Consistency Auditor

```
description: "Check documentation consistency across all files"
prompt: |
  DOCUMENTATION AUDIT: Cross-Reference Consistency

  Read ALL documentation files in the repository and check for internal consistency.

  READ ALL .md FILES including:
  - Root README.md
  - Any nested README.md files
  - CONTRIBUTING.md, AGENTS.md, CLAUDE.md, GEMINI.md, CHANGELOG.md
  - docs/ directory contents
  - Any other .md files at root or in config directories
  (Tip: If generated in Step 1, read `.scratch/docs-repomix.xml` for unified holistic context across all docs)

  CHECK FOR:
  1. Project name and description — consistent everywhere?
  2. Install/setup commands — same across all files?
  3. Feature lists — consistent and complete in each file?
  4. Version numbers and requirements — aligned?
  5. Directory structures — described the same way?
  6. CLI commands and API usage — consistent syntax?
  7. Contradictory instructions between files
  8. Terminology consistency (e.g., one file says "module", another says "package")

  RESPONSE FORMAT:
  ## Contradictions
  - [File A] says X but [File B] says Y → [which is correct and why]

  ## Inconsistent Terminology
  - [Term A] in [File] vs [Term B] in [File] → [recommended standard]

  ## Duplicated Content
  - [Content] appears in [files] — consider consolidating or cross-referencing

  ## Recommended Changes
  [How to resolve each inconsistency, with file and section references]
```

#### Agent 5: Nested Documentation Auditor (Monorepos Only)

Only launch this agent if the repository contains multiple packages, services, or apps:

```
description: "Audit sub-package and module documentation"
prompt: |
  DOCUMENTATION AUDIT: Nested Package Documentation

  Audit README.md files inside sub-packages, services, or modules.

  DISCOVERY:
  - List all directories that represent packages/services/modules
  - Check which ones have a README.md and which don't

  FOR EACH PACKAGE WITH A README:
  1. Does the description match what the code actually does?
  2. Are install/usage instructions accurate?
  3. Are dependencies listed correctly?
  4. Are exported APIs/commands documented?
  5. Does it reference the root README appropriately?

  FOR EACH PACKAGE WITHOUT A README:
  1. Should it have one? (Skip if it's internal/utility only)
  2. What should it contain based on the code?

  RESPONSE FORMAT:
  ## Packages With READMEs
  ### [package-name]
  - Status: ✅ Accurate / ⚠️ Needs updates / ❌ Significantly outdated
  - Issues: [list]

  ## Packages Missing READMEs
  - [package-name]: [should it have one? what should it say?]

  ## Recommended Changes
  [Specific edits per package]
```

### Step 3: Collect and Consolidate Results

Wait for all agents to complete. Merge findings into a single structured report, deduplicating any overlapping issues.

### Step 4: Present the Audit Report

Present findings and proposed changes to the user. **Do not make any changes yet.**

```markdown
## 📋 Documentation Audit Report

### Summary
- Files audited: [count]
- Issues found: [count by severity]
- Files needing updates: [list]
- Missing documentation: [list]

### Findings by Area

#### README.md
[Consolidated findings from Agent 1]

#### Project Guides (CONTRIBUTING.md, AGENTS.md, CLAUDE.md, etc.)
[Consolidated findings from Agent 2]

#### Scripts & Tooling
[Consolidated findings from Agent 3]

#### Cross-Reference Consistency
[Consolidated findings from Agent 4]

#### Nested Package Docs (if applicable)
[Consolidated findings from Agent 5]

### Proposed Changes

Priority order (highest impact first):

1. **[file]**: [change description]
2. **[file]**: [change description]
...

### Questions for Clarification
[Any ambiguities that need user input before proceeding]

---
**Approve these changes?** (yes / no / modify)
```

### Step 5: Execute Approved Changes

**Only after explicit user approval**, make the changes:

1. Edit each file using targeted edits (prefer surgical edits over full rewrites)
2. Create new files only when documentation is missing entirely
3. Preserve the existing style, tone, and structure of each file
4. After all changes, show a diff-style summary of what was modified

### Step 6: Offer to Commit

After changes are applied:

```
Documentation has been updated. Would you like me to commit these changes?

Suggested commit message:
  docs: audit and update documentation [files changed]
```

---

## Scoped Audits

When invoked with a specific scope, only launch the relevant agent(s):

| Invocation | Agents Launched |
|---|---|
| `/docs-curator` | All applicable agents (skip Agent 5 for single-package repos) |
| `/docs-curator README.md` | Agent 1 (Primary README) |
| `/docs-curator AGENTS.md` | Agent 2 (Guides), scoped to AGENTS.md / CLAUDE.md / GEMINI.md |
| `/docs-curator CONTRIBUTING.md` | Agent 2 (Guides), scoped to CONTRIBUTING.md only |
| `/docs-curator scripts` | Agent 3 (Scripts & Tooling) |
| `/docs-curator consistency` | Agent 4 (Cross-Reference) |
| `/docs-curator packages` | Agent 5 (Nested Docs) |
| `/docs-curator links` | Deterministic dead-link check across docs using `markdown-link-check` or `check:doc-health` |
| `/docs-curator pack` | Repomix packaging of all docs (`.scratch/docs-repomix.xml`) for holistic analysis |
| `/docs-curator prd` | 审计 `docs/prd/` 下本地 PRD 文档规范、开篇 TOC 与实现决策完整性 |
| `/docs-curator specs` | 审计 `docs/specs/` 下技术规格书与 L2 领域 Hub 的双向挂载及接口完整性 |
| `/docs-curator issues` | 审计 `docs/issues/` 下本地工单切片的 Parent 关联、Blocked-by 依赖图与 Frontier |

---

## Principles

These principles guide every audit:

1. **Accuracy over style** — Focus on whether documentation is factually correct, not whether it's beautifully written. Don't reformat working documentation.
2. **Verify against source code** — Every claim in documentation should be checked against the actual codebase, configs, and scripts. Don't trust docs at face value.
3. **Automate facts, reason on meaning** — Rely on deterministic CLI tools (`markdown-link-check` for alive links, `repomix` for holistic codebase/doc aggregation) rather than guessing verifiable facts. Let the model focus on semantic accuracy and readability.
4. **Approval before changes** — Never modify documentation without presenting findings and getting explicit approval first.
5. **Minimal diffs** — Make the smallest edits necessary to fix issues. Preserve existing structure, tone, and formatting.
6. **Flag uncertainty** — If something is ambiguous or requires domain knowledge to verify, flag it as a question for the user rather than guessing.
7. **No phantom content** — Don't add documentation for features that don't exist. Don't remove documentation for features you can't find without asking first (they might live elsewhere).

---

## Configuration

| Setting | Value |
|---|---|
| Agent model | Default or best available flagship reasoning model |
| Parallel agents | Up to 5 |
| Approval required | Always — no silent edits |
| Scope | Adapts to repository structure |

---

## Compatibility

This skill is designed for use with any AI coding tools and agent runtimes that support agent/skill definitions:

- **Universal Agent Runtimes** — Native support via `.agents/skills/`, `.agents/rules/`, `AGENTS.md`
- **Claude Code** — Native support via `.claude/agents/` or `.claude/skills/`
- **Codex** — Adapt as a task definition or system prompt
- **Cursor** — Use as a `.cursorrules` workflow or custom command
- **OpenCode** — Include as an agent configuration
- **Other tools** — The structured prompts in Step 2 work as standalone instructions for any LLM-based coding assistant

The core audit prompts (Agents 1–5) are tool-agnostic. The outer workflow (parallel execution, approval flow, commit offering) should be adapted to your tool's capabilities.