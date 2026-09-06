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
- **One CLI test path.** `pnpm test:storybook`
  (`REPKEY_STORYBOOK_TESTS=true vitest run --project=storybook`) is the
  a11y-enforcing gate: it renders every story in headless Chromium, runs its
  play function, and FAILS on an axe violation. CI runs it in the
  `storybook-test` job. `run-story-tests` is the same project via MCP — use it
  for focused loops, and `pnpm test:storybook` before you consider UI work done.
  `pnpm test-storybook` and `@storybook/test-runner` are gone: that runner is a
  Storybook 8/9 tool whose jest runtime cannot load a Storybook 10 config, so
  every suite failed at setup and no test ran.
- **Do not set `VITEST_STORYBOOK`.** `addon-a11y` only throws when it reads
  `VITEST_STORYBOOK === "false"`, so setting it silently downgrades a11y to
  report-only. Project inclusion is keyed on `REPKEY_STORYBOOK_TESTS` and the
  project is named explicitly in `vitest.config.ts` for exactly this reason.
- Known gap: console errors no longer fail a story. The deleted runner did that
  via an allowlist in `.storybook/test-runner.ts`; the Vitest path filters
  console output reporter-side only.
- For new or updated stories, fetch current conventions with
  `get-storybook-story-instructions` before writing.
- Story files are CSF, co-located as `*.stories.tsx` next to the component
  (pattern: `src/components/ui/button.stories.tsx`). Stories must not
  **value-import** from `#/contexts/*/server` (`import type` is allowed) —
  enforced by `scripts/check-component-boundaries.mjs`.
