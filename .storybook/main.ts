// Storybook main config.
//
// ── Component-test runner decision (BQC-6.3) ─────────────────────────────
// Two story runners exist with green parity (74 files / 379 tests each):
//
// ONE runner: the Vitest browser project (`pnpm test:storybook`), which the
// `storybook-test` CI job runs. It renders every story in headless Chromium,
// runs its play function, and enforces the a11y `test: 'error'` config from
// ./preview.tsx — an axe violation fails the story.
//
// @storybook/test-runner used to be the gate. It is a Storybook 8/9 tool: under
// Storybook 10 its jest runtime cannot even load the config
// (`throwHooksUnsupported`), so every suite failed at setup and no test ran. It
// is deleted.
//
// Enforcement depends on a flag split that is easy to undo by accident.
// addon-a11y only throws when it reads `import.meta.env.VITEST_STORYBOOK ===
// "false"`, and addon-vitest forwards `process.env.VITEST_STORYBOOK` into that.
// The project's existence is therefore gated on REPKEY_STORYBOOK_TESTS instead,
// and the project is named explicitly in vitest.config.ts because the plugin
// only force-names it when VITEST_STORYBOOK is set. Setting VITEST_STORYBOOK
// would silently turn a11y back into report-only.
//
// Known gap: the old runner also failed a story on any console.error, using an
// allowlist in the deleted ./test-runner.ts. The Vitest path filters console
// output reporter-side only, so console errors no longer fail a story.
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
