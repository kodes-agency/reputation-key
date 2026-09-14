import { defineConfig, devices } from '@playwright/test'
import { STORYBOOK_PORT, STORYBOOK_URL } from './e2e/storybook-metrics/storybook-server'

// Real-browser geometry against STORYBOOK, not the app. Run it with
// `pnpm test:storybook:metrics`.
//
// A separate config, not a project in `playwright.config.ts`, because the two
// cannot share a test tree or a precondition:
//
//   - that config's `testDir` is `./e2e` and its `full` project matches every
//     `*.spec.ts` outside `critical/`, against the app on :3000 with the
//     `setup` project's seed gate as a dependency. A Storybook harness named
//     `.spec.ts` anywhere under `e2e/` would be swept into every full e2e run
//     and fail it for want of Storybook. So this config's files are
//     `*.metrics.ts`, in their own `testDir`, and neither config can see the
//     other's tests (`pnpm exec playwright test --list` does not list them);
//   - that config owns no application process ("host Playwright owns no
//     application process"). This one does own one: the Storybook dev server,
//     below, because the harness is meaningless without compiled Tailwind and
//     Storybook is the only place the inbox stories render with it.
//
// ── CI ──────────────────────────────────────────────────────────────────────
//
// NOT wired into `.github/workflows/ci.yml`, on purpose, and that is a gap.
// A gate nobody is made to run lets a PR that lowers a toolbar member to 28 px
// merge with every CI check green — the failure v1's phone commit already
// recorded: "Three separate passes found controls under the 44 px floor that
// source review and the Storybook gate both missed" (`git show -s 2a83876c`).
// A path-scoped CI job was written and proven (502 passed in CI mode against a
// cold Storybook), but adding ~6 minutes of Chromium to every relevant pull
// request and every push to main is a decision about the team's CI budget, so
// it is held out of the tree for the product owner. Until then: run
// `pnpm test:storybook:metrics` before merging a change the pane renders.
//
// ── Which Storybook ─────────────────────────────────────────────────────────
//
// Locally a running Storybook is reused, and `globalSetup` proves it serves
// THIS checkout before a single story loads (`storybook-server.ts` says how,
// and what review found without it). Under `CI` nothing is reused and the run
// starts its own — the mode a CI job would use, proven cold in an isolated copy.
export default defineConfig({
  testDir: './e2e/storybook-metrics',
  // NOT `.spec.ts` — see the header. Helpers in the same directory
  // (`pane-metrics.ts`, `storybook-story.ts`, `inbox-detail-stories.ts`) are
  // plain modules and match nothing.
  testMatch: /.*\.metrics\.ts$/,
  // Runs after `webServer` is up (Playwright starts plugins, then global
  // setups) and before any test: the checkout-identity proof.
  globalSetup: './e2e/storybook-metrics/storybook-server.ts',
  // One story load, its play, every layer its pane can open and its
  // disclosures. Each of those actions has its own 5 s timeout
  // (`layer-probe.ts`) and stops 20 s before this one, so a regression is a
  // printed line rather than this timeout. The margin is for a cold dev
  // server, which transforms a story file on its first request.
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  // Always, not `!!process.env.CI` as `playwright.config.ts` has it. That
  // config's `.only` guard has a second line behind it: `lint:ci` runs
  // `scripts/check-test-quality.mjs`, whose `TEST_FILE` pattern
  // (`/\.(?:test|spec)\.(?:ts|tsx)$|\.stories\.tsx$/`, `:165`) does NOT match
  // `*.metrics.ts`. Locally `CI` is not set, and a committed `test.only` would
  // narrow the gate to one story and still print green. Focus a local
  // debugging run with `--grep` instead.
  forbidOnly: true,
  // No retry. Geometry is deterministic: the same classes at the same width
  // give the same box. A run that passes only on a second attempt means the
  // wait in `storybook-story.ts` is wrong, and a retry would hide exactly that.
  retries: 0,
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/storybook-metrics/report.json' }],
  ],
  // Isolated from `test-results/playwright` so neither config's cleanup
  // deletes the other's evidence.
  outputDir: 'test-results/storybook-metrics/artifacts',
  use: {
    baseURL: STORYBOOK_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'storybook-metrics',
      // Desktop Chrome's device descriptor; each describe block in the harness
      // overrides only `viewport`. No touch emulation: nothing in
      // `src/components/inbox` or `src/components/ui` keys a size on
      // `pointer: coarse`, so a coarse pointer would measure the same boxes.
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // `--ci` skips Storybook's interactive prompts; `--no-open` keeps it from
    // opening a browser tab. The port is `STORYBOOK_METRICS_PORT`, 6006 by
    // default — `pnpm storybook`'s.
    command: `pnpm exec storybook dev -p ${STORYBOOK_PORT} --ci --no-open`,
    url: STORYBOOK_URL,
    // Locally a developer usually has Storybook running already; measure that
    // one, once `globalSetup` has proved it is this checkout's. In CI never:
    // the job's server is the only one that can be trusted to be fresh.
    reuseExistingServer: !process.env.CI,
    // Storybook's first build of this tree is slow (minutes on a cold cache).
    timeout: 300_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
