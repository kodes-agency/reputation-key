// Fails the storybook run when a story page freezes, and names the story.
//
// A story page whose renderer main thread wedges runs no JavaScript, so
// Vitest's in-page test timeout never fires and the run waits for ever. From
// 2026-10-09 to 10-16 storybook-test hung seven times that way, always in
// portal-editor.stories.tsx (a Chromium compositor stall, written up in
// docs/operations/e2e-flake-register.md), and each time the job ended only at
// its timeout-minutes, with a log that named no story: the default reporter
// prints a file only once it finishes.
//
// This reporter runs in Vitest's Node process, which stays alive while a page
// is frozen. It notes the time of every event a started test file sends
// (tests and suites starting and finishing, hooks); when one file has sent
// nothing for STALL_MS it prints the file, the last test that finished and the
// test it is most likely stuck in, and exits the run with a failure. It knows
// a frozen page only as a quiet one, so the threshold sits well above anything
// a live page can be quiet for: Vitest's browser hook timeout is 30 s and its
// test timeout 15 s, and a live page reports either one itself. The slowest
// green story takes about 4 s, the slowest file 27 s, and a 45 s threshold on
// the hang diagnostics never fired on about 150 healthy CI batches.
//
// It watches files only from their start, after Vitest has imported them, and
// tells nothing about a page that freezes while a file is still being loaded.
//
// The storybook-test job adds it with `--reporter`; locally it is opt-in.

import type { Reporter } from 'vitest/node'

export const STALL_MS = 45_000
const CHECK_EVERY_MS = 1_000
/** Checks per threshold at least, so a short one in a test is still met on time. */
const CHECKS_PER_THRESHOLD = 5
const EXIT_CODE = 1
/** How long the report may take to write before the run exits regardless. */
const FLUSH_GRACE_MS = 5_000

// What the guard reads of Vitest's TestModule, TestSuite and TestCase. Narrow
// on purpose: Vitest's own classes satisfy these, and so do the test's stand-ins.
type GuardedModule = Readonly<{
  type: 'module'
  id: string
  relativeModuleId: string
  children: Readonly<{ allTests: () => Iterable<GuardedTest> }>
}>
type GuardedSuite = Readonly<{ type: 'suite'; fullName: string; module: GuardedModule }>
type GuardedTest = Readonly<{
  type: 'test'
  id: string
  fullName: string
  module: GuardedModule
  result: () => Readonly<{ state: string }>
}>
type GuardedHook = Readonly<{
  name: string
  entity: GuardedModule | GuardedSuite | GuardedTest
}>

/** A started file that has reported nothing for at least the threshold. */
export type StalledFile = Readonly<{
  /** The file, relative to the project root. */
  file: string
  /** How long it has reported nothing, in ms. */
  quietMs: number
  /** How long since it started, in ms. */
  runningMs: number
  /** The last thing it reported, such as `test "Button > Default" started`. */
  lastEvent: string
  /** The last test before the stuck one that ran, with its state; null if none did. */
  lastFinished: string | null
  /** The test it most likely froze in; null when every test had finished. */
  likelyStuck: Readonly<{ test: string; started: boolean }> | null
  /** Tests that finished or were skipped, of `total`. */
  finished: number
  total: number
}>

export type StallGuardOptions = Readonly<{
  /** How long a started file may report nothing before the run fails, in ms. */
  stallMs?: number
  /** Called once, with every quiet file. By default prints them and exits 1. */
  onStall?: (stalled: readonly StalledFile[]) => void
}>

type FileProgress = {
  readonly module: GuardedModule
  readonly startedAt: number
  lastEventAt: number
  lastEvent: string
  inFlight: GuardedTest | null
}

/** Result states of a test that ran; a skipped one did not. */
const RAN = new Set(['passed', 'failed'])

const seconds = (ms: number): number => Math.round(ms / 1_000)

function entityName(entity: GuardedHook['entity']): string {
  return entity.type === 'module' ? entity.relativeModuleId : `"${entity.fullName}"`
}

function moduleOf(entity: GuardedHook['entity']): GuardedModule {
  return entity.type === 'module' ? entity : entity.module
}

function describeTest(test: GuardedTest): string {
  return `${test.fullName} (${test.result().state})`
}

// Which test is stuck is read from the tests' states, not from the events.
// The page sends both in batches, at most one per 100 ms, so a page that
// freezes keeps the last few events it queued: a test can arrive passed while
// the events saying it finished, and that the next one started, never do. Its
// stories run one after another, so the first unfinished one is the stuck one.
function stalledFile(progress: FileProgress, now: number): StalledFile {
  const tests = [...progress.module.children.allTests()]
  const stuckAt = tests.findIndex((test) => test.result().state === 'pending')
  const stuck = tests[stuckAt] ?? null
  const before = stuckAt === -1 ? tests : tests.slice(0, stuckAt)
  const lastRan = before.filter((test) => RAN.has(test.result().state)).at(-1) ?? null
  return {
    file: progress.module.relativeModuleId,
    quietMs: now - progress.lastEventAt,
    runningMs: now - progress.startedAt,
    lastEvent: progress.lastEvent,
    lastFinished: lastRan && describeTest(lastRan),
    likelyStuck: stuck && {
      test: stuck.fullName,
      started: stuck.id === progress.inFlight?.id,
    },
    finished: tests.filter((test) => test.result().state !== 'pending').length,
    total: tests.length,
  }
}

function stuckLine(likelyStuck: StalledFile['likelyStuck']): string {
  if (likelyStuck === null) return 'none left: the file went quiet after its last test'
  return likelyStuck.started
    ? `${likelyStuck.test} (started, never finished)`
    : `${likelyStuck.test} (next in the file; its start was never reported)`
}

/** The report the run fails with, one block per quiet file. */
export function describeStalls(stalled: readonly StalledFile[]): string {
  const blocks = stalled.map((file) =>
    [
      `Storybook stall guard: ${file.file} reported nothing for ${seconds(file.quietMs)} s ` +
        `(running ${seconds(file.runningMs)} s, ${file.finished} of ${file.total} tests finished).`,
      `  Last finished: ${file.lastFinished ?? 'none yet'}`,
      `  Likely stuck:  ${stuckLine(file.likelyStuck)}`,
      `  Last event:    ${file.lastEvent}`,
    ].join('\n'),
  )
  return [
    ...blocks,
    "A frozen story page runs no JavaScript, so Vitest's own test timeout cannot fire there.",
    'Failing the run now instead of waiting for the job timeout.',
  ].join('\n')
}

// GitHub's workflow-command escaping, as in @actions/core.
const escapeData = (text: string): string =>
  text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
const escapeProperty = (text: string): string =>
  escapeData(text).replaceAll(':', '%3A').replaceAll(',', '%2C')

/** A GitHub error annotation on the quiet file, so the check names the story. */
export function stallAnnotation(file: StalledFile): string {
  const { likelyStuck } = file
  const subject =
    likelyStuck === null
      ? 'The file, after its last test,'
      : `${likelyStuck.test}${likelyStuck.started ? '' : ' (next in the file)'}`
  const message =
    `${subject} froze: its file reported nothing for ${seconds(file.quietMs)} s. ` +
    `Last finished: ${file.lastFinished ?? 'none yet'}.`
  return `::error file=${escapeProperty(file.file)},title=Storybook stall::${escapeData(message)}`
}

function failTheRun(stalled: readonly StalledFile[]): void {
  const annotations =
    process.env.GITHUB_ACTIONS === 'true' ? stalled.map(stallAnnotation) : []
  const exit = (): never => process.exit(EXIT_CODE)
  setTimeout(exit, FLUSH_GRACE_MS)
  process.stderr.write(
    `\n${[describeStalls(stalled), ...annotations].join('\n')}\n`,
    exit,
  )
}

export default class StorybookStallGuard implements Reporter {
  readonly #stallMs: number
  readonly #onStall: (stalled: readonly StalledFile[]) => void
  readonly #files = new Map<string, FileProgress>()
  #timer: ReturnType<typeof setInterval> | null = null
  #reported = false

  constructor(options: StallGuardOptions = {}) {
    this.#stallMs = options.stallMs ?? STALL_MS
    this.#onStall = options.onStall ?? failTheRun
  }

  onTestModuleStart(module: GuardedModule): void {
    const now = Date.now()
    this.#files.set(module.id, {
      module,
      startedAt: now,
      lastEventAt: now,
      lastEvent: 'file started',
      inFlight: null,
    })
    this.#watch()
  }

  onTestModuleEnd(module: GuardedModule): void {
    this.#files.delete(module.id)
  }

  onTestSuiteReady(suite: GuardedSuite): void {
    this.#progress(suite.module, `suite "${suite.fullName}" started`)
  }

  onTestSuiteResult(suite: GuardedSuite): void {
    this.#progress(suite.module, `suite "${suite.fullName}" finished`)
  }

  onHookStart(hook: GuardedHook): void {
    this.#progress(
      moduleOf(hook.entity),
      `${hook.name} of ${entityName(hook.entity)} started`,
    )
  }

  onHookEnd(hook: GuardedHook): void {
    this.#progress(
      moduleOf(hook.entity),
      `${hook.name} of ${entityName(hook.entity)} ended`,
    )
  }

  onTestCaseReady(test: GuardedTest): void {
    const progress = this.#progress(test.module, `test "${test.fullName}" started`)
    if (progress) progress.inFlight = test
  }

  onTestCaseResult(test: GuardedTest): void {
    const state = test.result().state
    const progress = this.#progress(test.module, `test "${test.fullName}" ${state}`)
    if (progress?.inFlight?.id === test.id) progress.inFlight = null
  }

  onTestRunEnd(): void {
    this.#stop()
  }

  #progress(module: GuardedModule, event: string): FileProgress | undefined {
    const progress = this.#files.get(module.id)
    if (!progress) return undefined
    progress.lastEventAt = Date.now()
    progress.lastEvent = event
    return progress
  }

  #watch(): void {
    if (this.#timer !== null || this.#reported) return
    const every = Math.min(CHECK_EVERY_MS, this.#stallMs / CHECKS_PER_THRESHOLD)
    this.#timer = setInterval(() => this.#check(), every)
    // The guard must never be what keeps a finished or crashed run alive.
    this.#timer.unref()
  }

  #stop(): void {
    if (this.#timer !== null) clearInterval(this.#timer)
    this.#timer = null
  }

  #check(): void {
    const now = Date.now()
    const quiet = [...this.#files.values()].filter(
      (progress) => now - progress.lastEventAt >= this.#stallMs,
    )
    if (quiet.length === 0) return
    this.#reported = true
    this.#stop()
    this.#onStall(quiet.map((progress) => stalledFile(progress, now)))
  }
}
