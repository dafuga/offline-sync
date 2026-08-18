# AGENTS.md

This is a Harness Bun TypeScript library. Treat Harness as the operating contract for every code change in this project.

## Required Harness Workflow

- Read this file and the `.codex/skills/harness/SKILL.md` skill before changing code.
- Use Harness generators for supported code shapes instead of hand-rolling new structure.
- Ask `harness info <topic>` before adding unfamiliar code or choosing a scaffold shape.
- For non-trivial work, ask what the loop should prove, search templates, then create or continue a `harness loop`.
- Add or update a feature spec before implementation.
- Keep files small, focused, and aligned with `harness.audit.json` limits.
- Run `bun run check` before handing work back; it includes formatting, type checks, lint, tests, build, and `bun run audit`.

## Code Rules

- Files stay at or below 220 lines.
- Functions stay at or below 55 lines.
- Classes stay at or below 120 lines.
- Methods stay at or below 35 lines.
- Nesting stays at or below 4 levels.
- Functions and methods take at most 4 parameters.
- Cyclomatic complexity stays at or below 10.
- Each file defines at most 1 class.
- Generated scaffold file names should keep the casing and suffixes prescribed by Harness.
- Function exports should use camelCase and generated function files should export the expected name.
- Classes should not use catch-all Manager names.
- Command modules delegate to workflows instead of importing templates or file-generation helpers.
- Core, template, workflow, and command imports move in one direction.
- Harness audit applies ecosystem adapters for app and library code surfaces.
- Unsupported file types must appear in audit coverage instead of being skipped silently.

Hard limits: files 220, functions 55, classes 120, methods 35, nesting 4.
