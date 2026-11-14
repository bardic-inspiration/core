---
name: readme
description: Rewrite a project's README into a short, conventional open-source README — what the project is, how to install and run it, where the docs are, and its license. Use when the user asks to rewrite, trim, clean up, or standardize a README, or invokes /readme directly.
---

# README

Rewrite `README.md` so a newcomer learns, in one short page, what the project
is, how to get it running, where to read more, and how it's licensed. Assume
an open-source project in early development, and err toward concision.

## Read first

Gather facts; don't invent them.

- The current `README.md` — keep its accurate facts, drop the rest.
- `package.json` (or the stack's manifest) — name, scripts, engine version,
  license.
- `LICENSE`, and any third-party licensing notes in the current README.
- `CONTRIBUTING.md` — clone URL and setup steps a newcomer needs.
- The docs that exist: `SPEC.md`, `AGENTS.md`, `CONTRIBUTING.md`, `docs/`.
  Link only files that exist.

## Structure

Exactly these sections, in this order:

1. **`# <Project name>`** — one or two sentences on what it is and who it's
   for. Then a one-line **Status** (e.g. "early development; expect
   breaking changes").
2. **`## Install and run`** — the runtime version required, then the
   shortest working path: clone, install, run. One command per fenced
   `bash` block. Include a prerequisite only if install or run fails without
   it (e.g. a git config rewrite, a one-time browser install).
3. **`## Documentation`** — a bulleted list of links, each with a few words
   on what it holds. Put user-facing docs first, contributor docs after.
4. **`## License`** — the license, linked to `LICENSE`, plus any
   third-party attribution that must travel with the code.

## Cut

Move nothing new into the README; remove what other docs already cover or
what a newcomer doesn't need to start:

- Layout and file maps, architecture diagrams, test inventories.
- Process narration ("how this repo is built"), decision logs, build notes,
  known gaps and benchmarks.
- Exhaustive command lists — the gate and a run command are enough;
  link `AGENTS.md` or `CONTRIBUTING.md` for the rest.

If cut material exists nowhere else, say so to the user before dropping it,
so they can choose to keep it or move it into a doc.

## Ship it

A README-only change is docs-only (`docs/workflow.md` "Docs-only changes"):
no tests, no `check`. Title the PR `docs: rewrite README for concision`, and
name in its description what was cut and where that material already lives.
