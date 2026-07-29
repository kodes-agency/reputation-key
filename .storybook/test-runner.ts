// @storybook/test-runner configuration — this runner is the ONE authoritative
// component gate in CI (render smoke + play assertions + a11y + console
// errors). The runner decision and the vitest browser project's non-gate role
// are documented in .storybook/main.ts (BQC-6.3).
//
// Console gate: `pnpm test-storybook` runs with --failOnConsole, so any
// console.error during a story fails it (the runner's setup-page script
// collects errors and rejects after render). This config installs a NARROW
// allowlist that swallows only proven-benign error classes before they reach
// that gate — same allowlist discipline as BQC-6.2 (pattern + owner + reason
// per entry, story-scoped where the error is a deliberate fixture). Anything
// else still fails the story.
//
// Mechanism (why defineProperty, not a plain console.error wrap): the runner
// re-installs its console spy INSIDE __test, per story — on top of whatever
// console.error it finds, and it latches `hasErrors` BEFORE forwarding the
// call down the chain. A wrapper installed underneath the spy therefore
// suppresses nothing. Instead, preVisit turns console.error into an
// accessor: every later assignment (each story's fresh spy) is intercepted by
// the setter, which wraps the new spy with the allowlist filter — keeping the
// filter ABOVE every spy for the life of the page. The current story id is
// kept in a page global the filter consults at call time.
import type { TestRunnerConfig } from '@storybook/test-runner'

type BenignConsoleError = Readonly<{
  /** Matches against the joined console.error arguments (Errors → .message). */
  pattern: RegExp
  /** When set, the suppression applies ONLY to these story ids. */
  stories?: ReadonlyArray<string>
  owner: string
  reason: string
}>

const BENIGN_CONSOLE_ERRORS: ReadonlyArray<BenignConsoleError> = [
  {
    // React dev-mode logs every error caught by an error boundary via
    // console.error — printf-style ("%o\n\n%s\n\n%s\n", err, "The above error
    // occurred in the <X> component...", "...recreate... <Boundary>.") — so
    // the boundary text appears mid-arguments, not at the start. The
    // ErrorState story throws ON PURPOSE (rejected query fixture) to render
    // the boundary — the throw is the fixture, the boundary render is the
    // assertion. Scoped to that story id only: boundary-caught errors in ANY
    // other story still fail the gate (that class is what --failOnConsole
    // exists to catch — see the InboxDetailContent regression this slice
    // fixed).
    pattern: /The above error occurred in the <StaffHomeHarness> component/,
    stories: ['staff-home--error-state'],
    owner: 'BQC-6.3',
    reason:
      'deliberate error-boundary story fixture; React dev boundary log, not a defect',
  },
]

const config: TestRunnerConfig = {
  async preVisit(page, context) {
    await page.evaluate(
      ({ entries, storyId }) => {
        const win = window as unknown as { __bqcCurrentStoryId?: string }
        win.__bqcCurrentStoryId = storyId

        const consoleWithFlag = console as Console & {
          __bqcGateInstalled?: boolean
        }
        if (consoleWithFlag.__bqcGateInstalled) return
        consoleWithFlag.__bqcGateInstalled = true

        const allowlist = entries.map((entry) => ({
          re: new RegExp(entry.source),
          stories: entry.stories ?? null,
        }))
        const isSuppressed = (args: unknown[]) => {
          const text = args
            .map((arg) => (arg instanceof Error ? arg.message : String(arg)))
            .join(' ')
          return allowlist.some(
            (entry) =>
              entry.re.test(text) &&
              (entry.stories === null ||
                entry.stories.includes(win.__bqcCurrentStoryId ?? '')),
          )
        }

        let current: (...args: unknown[]) => void = console.error.bind(console)
        Object.defineProperty(console, 'error', {
          configurable: true,
          get() {
            return current
          },
          set(fn: (...args: unknown[]) => void) {
            const wrapped = function (this: unknown, ...args: unknown[]) {
              if (isSuppressed(args)) return
              return fn.apply(this, args)
            }
            current = wrapped
          },
        })
      },
      {
        entries: BENIGN_CONSOLE_ERRORS.map((entry) => ({
          source: entry.pattern.source,
          stories: entry.stories ?? null,
        })),
        storyId: context.id,
      },
    )
  },
}

export default config
