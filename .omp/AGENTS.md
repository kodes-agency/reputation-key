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
  project in `vitest.config.ts`) — the fast dev/agent loop (render + play fns).
  For focused runs pass `{ stories: [{ storyId }] }`.
- **Two CLI test paths with distinct roles** (both are kept deliberately):
  `pnpm test-storybook` (Playwright `@storybook/test-runner`) is the
  **a11y-enforcing gate** — it FAILS the suite on axe violations and is what CI
  runs in the `storybook-test` job. `pnpm test:storybook` (`VITEST_STORYBOOK=true
vitest run --project='storybook:**'`) is the vitest equivalent of
  `run-story-tests` — fast render/interaction checks that REPORT a11y but do not
  fail on it. When you change UI, run `pnpm test-storybook` to catch real a11y
  regressions; use `run-story-tests` / `pnpm test:storybook` for quick loops.
- For new or updated stories, fetch current conventions with
  `get-storybook-story-instructions` before writing.
- Story files are CSF, co-located as `*.stories.tsx` next to the component
  (pattern: `src/components/ui/button.stories.tsx`). Stories must not
  **value-import** from `#/contexts/*/server` (`import type` is allowed) —
  enforced by `scripts/check-component-boundaries.mjs`.
