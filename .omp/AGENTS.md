# rep-key — agent notes

## Storybook

Stories are CSF, co-located as `*.stories.tsx` next to the component
(pattern: `src/components/features/<area>/<name>.stories.tsx`). They must not
**value-import** from `#/contexts/*/server` (`import type` is allowed) —
enforced by `scripts/check-component-boundaries.mjs`.

**One runner.** `pnpm test:storybook` (`REPKEY_STORYBOOK_TESTS=true vitest run
--project=storybook`, `@storybook/addon-vitest` in headless Chromium) renders
every story, runs its play function, and is the accessibility gate: the
`@storybook/addon-a11y` parameters in `.storybook/preview.tsx` are set to
`test: 'error'`, so an axe violation fails the run. CI's `storybook-test` job
runs the same command. There is no `@storybook/test-runner` and no
`pnpm test-storybook` (Storybook 10 dropped the runner; see
`.storybook/main.ts`).

When working on UI components (`src/components/**`):

- **Never assume component props.** Read the component source and its
  co-located story for the real arg API; do not infer props from naming
  conventions or other libraries.
- Loop: change the component and its story → `pnpm test:storybook` (focused
  with `-t "<story name>"` or by file path) → keep the a11y result green.
- `pnpm storybook` (port 6006) is the interactive dev server for visual checks;
  it is not a gate.
