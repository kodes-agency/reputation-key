# rep-key — agent notes

## Storybook MCP

A `storybook` MCP server (root `.mcp.json`) exposes this project's component
docs, story-generation guidance, and story tests. It is served by the Storybook
dev server at `http://localhost:6006/mcp`.

**Prerequisite:** the MCP tools only work while Storybook is running. Start it
with `pnpm storybook` (port 6006) before calling any `storybook` MCP tool; if a
tool errors with a connection refused, run `pnpm storybook` first.

When working on UI components (`src/components/**`):

- **Never assume component props.** `get-documentation({ id })` returns each
  component's story catalog with rendered JSX + imports (NOT a prop table) —
  use it to see real usage, then read the component source for the full arg API
  (defaults, types). The `id` is the one `list-all-documentation` returns (e.g.
  `"ui-button"`). Do not infer props from naming conventions or other libraries.
- Workflow: `list-all-documentation` to enumerate components →
  `get-documentation({ id: "..." })` (or `get-documentation-for-story`) for the
  target component's story code/imports → make the change → `run-story-tests`
  to verify.
- Available tools (all enabled): `list-all-documentation`, `get-documentation`,
  `get-documentation-for-story`, `get-storybook-story-instructions`,
  `preview-stories`, `run-story-tests`. `run-story-tests` runs stories in
  headless Chromium via `@storybook/addon-vitest` (the `storybook` vitest
  project in `vitest.config.ts`) and reports component + accessibility results;
  it is the primary verification path. For focused runs pass
  `{ stories: [{ storyId }] }`. CLI equivalents: `pnpm test:storybook` (the
  vitest storybook project, scoped via `--project='storybook:**'`) and
  `pnpm test-storybook` (legacy Playwright test-runner fallback).
- For new or updated stories, fetch current conventions with
  `get-storybook-story-instructions` before writing.
- Story files are CSF, co-located as `*.stories.tsx` next to the component
  (pattern: `src/components/ui/button.stories.tsx`). Stories must not
  **value-import** from `#/contexts/*/server` (`import type` is allowed) —
  enforced by `scripts/check-component-boundaries.mjs`.
