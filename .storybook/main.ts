// Storybook main config.
//
// ── Component-test runner decision (BQC-6.3) ─────────────────────────────
// Two story runners exist with green parity (74 files / 379 tests each):
//
// 1. @storybook/test-runner (`pnpm test-storybook`, against the dev server)
//    — THE ONE AUTHORITATIVE GATE. Runs in CI (`storybook-test` job) with
//    --failOnConsole (console.error during a story fails it; narrow benign
//    allowlist lives in ./test-runner.ts) and enforces the a11y `test:'error'`
//    config from ./preview.tsx (axe violations fail the story via the
//    runner's own setup-page script, independent of addon behavior).
//
// 2. Vitest browser project (`pnpm test:storybook`, VITEST_STORYBOOK=true)
//    — a dev/MCP tool, NOT a gate. Kept because @storybook/addon-mcp
//    (registered below) and the in-editor story-test experience drive it,
//    but it feeds no release evidence: its a11y hard throw can never fire
//    (addon-a11y gates it on VITEST_STORYBOOK === "false", which this repo's
//    script must set to "true" for the project to exist — the measured
//    compatibility issue behind keeping the legacy runner), onConsoleLog is
//    reporter-side filtering only, and onUnhandledError misses
//    boundary-caught React errors.
// ─────────────────────────────────────────────────────────────────────────
import type { StorybookConfig } from '@storybook/react-vite'
import { fileURLToPath } from 'node:url'
// Polyfill for node:async_hooks (better-auth) — aliased in viteFinal.
const asyncHooksStub = fileURLToPath(new URL('./stubs/async-hooks.ts', import.meta.url))
// Stub for #/contexts/review/server/reply — the real module leaks
// @tanstack/start-server-core via #/composition + createServerFn. See
// ./stubs/review-reply-server.ts for the full rationale.
const reviewReplyStub = fileURLToPath(
  new URL('./stubs/review-reply-server.ts', import.meta.url),
)
// Stub for #/shared/observability/logger — pino pulls Node builtins that crash
// the preview if a throwing event handler loads it. See ./stubs/observability-logger.ts.
const observabilityLoggerStub = fileURLToPath(
  new URL('./stubs/observability-logger.ts', import.meta.url),
)
// Stub for #/contexts/portal/server/portal-links — the real module leaks
// @tanstack/start-server-core via createServerFn. See ./stubs/portal-links.ts.
const portalLinksStub = fileURLToPath(new URL('./stubs/portal-links.ts', import.meta.url))

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: [
    '@storybook/addon-a11y',
    '@storybook/addon-docs',
    '@storybook/addon-mcp',
    '@storybook/addon-vitest',
  ],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  // Belt-and-suspenders for storybook#33747: strip any TanStack/Nitro/devtools
  // plugin that slipped past the `isStorybook` gate in vite.config.ts.
  // Also polyfill node:async_hooks (better-auth) for the browser preview.
  viteFinal: async (cfg) => {
    cfg.plugins = (cfg.plugins ?? []).filter((p) => {
      if (p && typeof p === 'object' && 'name' in p) {
        const name = p.name
        if (
          typeof name === 'string' &&
          (name.includes('tanstack') ||
            name.includes('nitro') ||
            name.includes('devtools'))
        ) {
          return false
        }
      }
      return true
    })
    cfg.resolve = cfg.resolve ?? {}
    const existingAlias = Array.isArray(cfg.resolve.alias) ? cfg.resolve.alias : []
    cfg.resolve.alias = [
      ...existingAlias,
      { find: 'node:async_hooks', replacement: asyncHooksStub },
      { find: 'async_hooks', replacement: asyncHooksStub },
      { find: '#/contexts/review/server/reply', replacement: reviewReplyStub },
      { find: '#/shared/observability/logger', replacement: observabilityLoggerStub },
      { find: '#/contexts/portal/server/portal-links', replacement: portalLinksStub },
    ]
    return cfg
  },
}

export default config
