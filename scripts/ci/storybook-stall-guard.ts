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
// is frozen. It notes the time of every update a started test file sends
// (tests and suites starting and finishing, hooks, and each story's own word
// that it started); when one file has sent nothing for STALL_MS it prints the
// file and the story it froze in, and exits the run with a failure. It knows a
// frozen page only as a quiet one, so the threshold sits well above anything a
// live page can be quiet for: Vitest's browser hook timeout is 30 s and its
// test timeout 15 s, and a live page reports either one itself. The slowest
// green story takes about 4 s, the slowest file 27 s, and a 45 s threshold on
// the hang diagnostics never fired on about 150 healthy CI batches.
//
// What it cannot see: a page that freezes while Vitest is still importing a
// file (it watches files from their start), and, once it exits, the other
// reporters' end-of-run summary, so a run that also failed for another reason
// shows those tests only on their files' lines until the next run.
//
// The storybook-test job adds it with `--reporter`; locally it is opt-in.

import type { Reporter } from 'vitest/node'
// With its extension, so plain Node can load the guard too, as its tests do.
import { listenForStoryStarts, type StoryStart } from './storybook-story-starts.ts'

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

/** A started file that has sent no update for at least the threshold. */
export type StalledFile = Readonly<{
  /** The file, relative to the project root. */
  file: string
  /** How long it has sent nothing, in ms. */
  quietMs: number
  /** How long since it started, in ms. */
  runningMs: number
  /** The last update it sent, such as `test "Button > Default" started`. */
  lastEvent: string
  /** The story it froze in, or before; null when it froze after its last story. */
  stuck: string | null
  /**
   * Whether its page confirmed `stuck` started (storybook-story-starts.ts).
   * True: it froze in `stuck`. False: the page confirmed an earlier story,
   * which then finished, and never `stuck`, so it froze before `stuck`
   * rendered. Null: the page confirmed none of its stories, so `stuck` is the
   * first it had not reported finished, and `orNext` the other candidate.
   */
  startConfirmed: boolean | null
  /** Only when `startConfirmed` is null: the test after `stuck`, where it froze if `stuck` finished in the batch that never came. */
  orNext: string | null
  /** The last test before `stuck` that ran, with its state; null if none had. */
  lastFinished: string | null
  /** Tests it reported finished or skipped, of `total`. */
  finished: number
  total: number
  /** Why its tests could not be read, when they could not; the rest is then empty. */
  unreadable: string | null
}>

export type StallGuardOptions = Readonly<{
  /** How long a started file may send nothing before the run fails, in ms. */
  stallMs?: number
  /** Called once, with every quiet file. By default prints them and exits 1. */
  onStall?: (stalled: readonly StalledFile[]) => void
}>

type FileProgress = Readonly<{
  module: GuardedModule
  startedAt: number
  lastEventAt: number
  lastEvent: string
}>

/** Result states of a test that ran; a skipped one did not. */
const RAN = new Set(['passed', 'failed'])

const seconds = (ms: number): number => Math.round(ms / 1_000)
const isPending = (test: GuardedTest): boolean => test.result().state === 'pending'

function entityName(entity: GuardedHook['entity']): string {
  return entity.type === 'module' ? entity.relativeModuleId : `"${entity.fullName}"`
}

function moduleOf(entity: GuardedHook['entity']): GuardedModule {
  return entity.type === 'module' ? entity : entity.module
}

type Candidates = Readonly<{
  stuckAt: number
  startConfirmed: boolean | null
  orNextAt: number
}>

// Where the file froze. A file's stories run one at a time, and each story's
// page confirms it started, and waits for the answer, before it renders
// (storybook-story-starts.ts). So when the story the page confirmed last has
// not finished, the page froze in it, even if the stories before it never
// reported finishing. When that story did finish, the page froze after it and
// before the next one rendered.
//
// Without a confirmation, it is a guess from the tests' states. The page sends
// states and events together, in batches at most one per 100 ms, and a page
// that freezes never sends the batch it was filling. A probe story that froze
// at once showed both shapes: locally the last update had the story before it
// passed, in its afterEach; on CI it had that story still running, last heard
// of ending its beforeEach. So the stuck story is the first the file had not
// reported finished or, when that one finished in the lost batch, the one
// after it. A story on CI mostly takes longer than one batch, so the lost batch
// rarely spans more.
function candidates(
  tests: readonly GuardedTest[],
  startedId: string | undefined,
): Candidates {
  const pendingAfter = (index: number): number =>
    tests.findIndex((test, at) => at > index && isPending(test))
  const started =
    startedId === undefined ? undefined : tests.find((test) => test.id === startedId)
  if (started === undefined) {
    const stuckAt = pendingAfter(-1)
    return {
      stuckAt,
      startConfirmed: null,
      orNextAt: stuckAt === -1 ? -1 : pendingAfter(stuckAt),
    }
  }
  const startedAt = tests.indexOf(started)
  if (isPending(started))
    return { stuckAt: startedAt, startConfirmed: true, orNextAt: -1 }
  const stuckAt = pendingAfter(startedAt)
  return { stuckAt, startConfirmed: stuckAt === -1 ? null : false, orNextAt: -1 }
}

function whereItFroze(
  progress: FileProgress,
  startedId: string | undefined,
): Pick<
  StalledFile,
  | 'stuck'
  | 'startConfirmed'
  | 'orNext'
  | 'lastFinished'
  | 'finished'
  | 'total'
  | 'unreadable'
> {
  try {
    const tests = [...progress.module.children.allTests()]
    const { stuckAt, startConfirmed, orNextAt } = candidates(tests, startedId)
    const before = stuckAt === -1 ? tests : tests.slice(0, stuckAt)
    const lastRan = before.filter((test) => RAN.has(test.result().state)).at(-1)
    return {
      stuck: tests[stuckAt]?.fullName ?? null,
      startConfirmed,
      orNext: tests[orNextAt]?.fullName ?? null,
      lastFinished: lastRan ? `${lastRan.fullName} (${lastRan.result().state})` : null,
      finished: tests.filter((test) => !isPending(test)).length,
      total: tests.length,
      unreadable: null,
    }
  } catch (error) {
    // Vitest's task objects changed shape: the run must still fail, naming the file.
    return {
      stuck: null,
      startConfirmed: null,
      orNext: null,
      lastFinished: null,
      finished: 0,
      total: 0,
      unreadable: String(error),
    }
  }
}

function stalledFile(
  progress: FileProgress,
  startedId: string | undefined,
  now: number,
): StalledFile {
  return {
    file: progress.module.relativeModuleId,
    quietMs: now - progress.lastEventAt,
    runningMs: now - progress.startedAt,
    lastEvent: progress.lastEvent,
    ...whereItFroze(progress, startedId),
  }
}

/** The quoted full name of the test with `testId`, for the update that confirmed it started. */
function confirmedName(module: GuardedModule, testId: string): string {
  try {
    for (const test of module.children.allTests()) {
      if (test.id === testId) return `"${test.fullName}"`
    }
  } catch {
    // Unreadable tests are reported, with the error, if the file stalls.
  }
  return testId
}

function stuckLine(file: StalledFile): string {
  if (file.unreadable !== null)
    return `unknown, its tests could not be read (${file.unreadable})`
  if (file.stuck === null) return "the file's teardown, after its last story"
  if (file.startConfirmed === true) return `${file.stuck} (its page confirmed it started)`
  if (file.startConfirmed === false)
    return `${file.stuck}, before its page confirmed it started`
  return file.orNext === null
    ? `${file.stuck}, or the file's teardown after it`
    : `${file.stuck}, or the story after it, ${file.orNext}`
}

/** The report the run fails with, one block per quiet file. */
export function describeStalls(stalled: readonly StalledFile[]): string {
  const blocks = stalled.map((file) => {
    const counts =
      file.unreadable === null
        ? `, ${file.finished} of ${file.total} tests reported finished`
        : ''
    return [
      `Storybook stall guard: ${file.file} sent no update for ${seconds(file.quietMs)} s ` +
        `(running ${seconds(file.runningMs)} s${counts}).`,
      `  Stuck in:      ${stuckLine(file)}`,
      `  Last finished: ${file.lastFinished ?? 'none reported'}`,
      `  Last update:   ${file.lastEvent}`,
    ].join('\n')
  })
  return [
    ...blocks,
    "Each story's page confirms it started, and waits for the answer, before the story renders.",
    'Without a confirmation the guard goes by the batches a page sends its other updates in, at',
    'most one per 100 ms, and a frozen page never sends its last one: the stuck story is then',
    'the first it had not reported finished, or the next.',
    "A frozen page runs no JavaScript, so Vitest's own test timeout cannot fire there.",
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
  const message = `Stuck in ${stuckLine(file)}: the file sent no update for ${seconds(file.quietMs)} s.`
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
  /** Per file id, the test id of the story its page confirmed started last, this run. */
  readonly #started = new Map<string, string>()
  #timer: ReturnType<typeof setInterval> | null = null
  #stopListening: (() => void) | null = null
  #reported = false

  constructor(options: StallGuardOptions = {}) {
    this.#stallMs = options.stallMs ?? STALL_MS
    this.#onStall = options.onStall ?? failTheRun
  }

  onTestRunStart(): void {
    this.#started.clear()
    if (this.#stopListening !== null || this.#reported) return
    this.#stopListening = listenForStoryStarts((start) => this.#storyStarted(start))
  }

  onTestModuleStart(module: GuardedModule): void {
    const now = performance.now()
    this.#files.set(module.id, {
      module,
      startedAt: now,
      lastEventAt: now,
      lastEvent: 'file started',
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
    this.#progress(test.module, `test "${test.fullName}" started`)
  }

  onTestCaseResult(test: GuardedTest): void {
    this.#progress(test.module, `test "${test.fullName}" ${test.result().state}`)
  }

  onTestRunEnd(): void {
    this.#stop()
  }

  /** Reports every started file quiet for the threshold at `now`, once per run. */
  check(now: number = performance.now()): void {
    if (this.#reported) return
    const quiet = [...this.#files.values()].filter(
      (progress) => now - progress.lastEventAt >= this.#stallMs,
    )
    if (quiet.length === 0) return
    this.#reported = true
    this.#stop()
    this.#onStall(
      quiet.map((progress) =>
        stalledFile(progress, this.#started.get(progress.module.id), now),
      ),
    )
  }

  // A confirmation can come before the batch that reports its file started,
  // so it is kept by file id whether or not that file is watched yet.
  #storyStarted(start: StoryStart): void {
    this.#started.set(start.fileId, start.testId)
    const progress = this.#files.get(start.fileId)
    if (progress === undefined) return
    this.#progress(
      progress.module,
      `page confirmed ${confirmedName(progress.module, start.testId)} started`,
    )
  }

  #progress(module: GuardedModule, event: string): void {
    const progress = this.#files.get(module.id)
    if (progress === undefined) return
    this.#files.set(module.id, {
      ...progress,
      lastEventAt: performance.now(),
      lastEvent: event,
    })
  }

  #watch(): void {
    if (this.#timer !== null || this.#reported) return
    const every = Math.min(CHECK_EVERY_MS, this.#stallMs / CHECKS_PER_THRESHOLD)
    this.#timer = setInterval(() => this.check(), every)
    // The guard must never be what keeps a finished or crashed run alive.
    this.#timer.unref()
  }

  #stop(): void {
    if (this.#timer !== null) clearInterval(this.#timer)
    this.#timer = null
    this.#stopListening?.()
    this.#stopListening = null
  }
}
