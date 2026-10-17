// The storybook stall guard, driven three ways. Reporter events from small
// stand-ins for Vitest's TestModule and TestCase, under fake timers, pin down
// what it reports and when: only a started file that has gone quiet, measured
// from its last update, once, naming the story its page confirmed started when
// there is one. A child process runs its default ending: the report, the
// annotation, exit 1, and no timer that holds a process open. Two real Vitest
// runs check that the updates it listens for are the ones Vitest sends, that
// it listens for story starts during a run, by the task ids a test itself
// sees, and that Vitest can load it from its path as the storybook-test job
// does, so a Vitest upgrade that renames them fails here instead of leaving
// the guard watching nothing.

import { execFile } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { createVitest } from 'vitest/node'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import StorybookStallGuard, {
  STALL_MS,
  describeStalls,
  stallAnnotation,
  type StalledFile,
  type StallGuardOptions,
} from './storybook-stall-guard'
import { announceStoryStart } from './storybook-story-starts'

type FakeState = 'pending' | 'passed' | 'failed' | 'skipped'

type FakeTest = {
  readonly type: 'test'
  readonly id: string
  readonly fullName: string
  readonly module: FakeModule
  state: FakeState
  readonly result: () => Readonly<{ state: FakeState }>
}

type FakeModule = {
  readonly type: 'module'
  readonly id: string
  readonly relativeModuleId: string
  readonly tests: FakeTest[]
  readonly children: Readonly<{ allTests: () => Iterable<FakeTest> }>
}

function fakeModule(file: string, names: readonly string[]): FakeModule {
  const tests: FakeTest[] = []
  const module: FakeModule = {
    type: 'module',
    id: `module:${file}`,
    relativeModuleId: file,
    tests,
    children: { allTests: () => tests.values() },
  }
  for (const [index, name] of names.entries()) {
    const test: FakeTest = {
      type: 'test',
      id: `${module.id}_${index}`,
      fullName: `Probe > ${name}`,
      module,
      state: 'pending',
      result: () => ({ state: test.state }),
    }
    tests.push(test)
  }
  return module
}

function testNamed(module: FakeModule, name: string): FakeTest {
  const test = module.tests.find((candidate) => candidate.fullName === `Probe > ${name}`)
  if (test === undefined) throw new Error(`no test ${name} in ${module.relativeModuleId}`)
  return test
}

/** What the story's page sends from its first beforeEach, through the browser command. */
function confirmStarted(module: FakeModule, name: string): void {
  announceStoryStart({ fileId: module.id, testId: testNamed(module, name).id })
}

/** Reports `name` ready and then finished with `state`, as Vitest does. */
function runTest(
  guard: StorybookStallGuard,
  module: FakeModule,
  name: string,
  state: FakeState = 'passed',
): void {
  const test = testNamed(module, name)
  guard.onTestCaseReady(test)
  test.state = state
  guard.onTestCaseResult(test)
}

const FILE = 'src/components/ui/probe.stories.tsx'
const GUARD = resolve(import.meta.dirname, 'storybook-stall-guard.ts')
const GUARD_URL = pathToFileURL(GUARD).href
const runNode = promisify(execFile)

describe('a started file that goes quiet', () => {
  let stalls: (readonly StalledFile[])[]
  let guard: StorybookStallGuard

  beforeEach(() => {
    vi.useFakeTimers()
    stalls = []
    guard = new StorybookStallGuard({ onStall: (stalled) => stalls.push(stalled) })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('names the file, the first story not reported finished, and the one after it', () => {
    const module = fakeModule(FILE, ['Renders', 'Freezes', 'After'])
    guard.onTestModuleStart(module)
    runTest(guard, module, 'Renders')
    guard.onTestCaseReady(testNamed(module, 'Freezes'))

    vi.advanceTimersByTime(STALL_MS + 1_000)

    expect(stalls).toEqual([
      [
        {
          file: FILE,
          quietMs: STALL_MS,
          runningMs: STALL_MS,
          lastEvent: 'test "Probe > Freezes" started',
          stuck: 'Probe > Freezes',
          startConfirmed: null,
          orNext: 'Probe > After',
          lastFinished: 'Probe > Renders (passed)',
          finished: 1,
          total: 3,
          unreadable: null,
        },
      ],
    ])
  })

  it('goes by the states when the last updates had the story passed, in its afterEach', () => {
    // The probe story's local run: its page sent that the story before it
    // passed and began its afterEach, then froze in the probe.
    const module = fakeModule(FILE, ['Renders', 'Freezes', 'After'])
    const renders = testNamed(module, 'Renders')
    guard.onTestModuleStart(module)
    guard.onTestCaseReady(renders)
    renders.state = 'passed'
    guard.onHookStart({ name: 'afterEach', entity: renders })

    vi.advanceTimersByTime(STALL_MS)

    expect(stalls[0]?.[0]).toMatchObject({
      lastEvent: 'afterEach of "Probe > Renders" started',
      stuck: 'Probe > Freezes',
      orNext: 'Probe > After',
      lastFinished: 'Probe > Renders (passed)',
      finished: 1,
    })
  })

  it('offers the next story when the last updates had the one before still running', () => {
    // The probe story's CI run: the last update was the story before it
    // ending its beforeEach, so that story's finish was in the batch that
    // never came, and the probe is the next one.
    const module = fakeModule(FILE, ['Renders', 'Freezes', 'After'])
    const renders = testNamed(module, 'Renders')
    guard.onTestModuleStart(module)
    guard.onTestCaseReady(renders)
    guard.onHookEnd({ name: 'beforeEach', entity: renders })

    vi.advanceTimersByTime(STALL_MS)

    expect(stalls[0]?.[0]).toMatchObject({
      lastEvent: 'beforeEach of "Probe > Renders" ended',
      stuck: 'Probe > Renders',
      orNext: 'Probe > Freezes',
      lastFinished: null,
      finished: 0,
    })
  })

  it('passes over skipped tests on both sides of the stuck one', () => {
    const module = fakeModule(FILE, ['Renders', 'Off', 'Freezes', 'Also off', 'After'])
    guard.onTestModuleStart(module)
    runTest(guard, module, 'Renders', 'failed')
    testNamed(module, 'Off').state = 'skipped'
    testNamed(module, 'Also off').state = 'skipped'

    vi.advanceTimersByTime(STALL_MS)

    expect(stalls[0]?.[0]).toMatchObject({
      stuck: 'Probe > Freezes',
      orNext: 'Probe > After',
      lastFinished: 'Probe > Renders (failed)',
      finished: 3,
      total: 5,
    })
  })

  it('names the last story and nothing after it when that is the one left', () => {
    const module = fakeModule(FILE, ['Renders', 'Freezes'])
    guard.onTestModuleStart(module)
    runTest(guard, module, 'Renders')

    vi.advanceTimersByTime(STALL_MS)

    expect(stalls[0]?.[0]).toMatchObject({ stuck: 'Probe > Freezes', orNext: null })
  })

  it('names no story when the file had reported them all finished', () => {
    const module = fakeModule(FILE, ['Renders'])
    guard.onTestModuleStart(module)
    runTest(guard, module, 'Renders')
    guard.onHookStart({ name: 'afterAll', entity: module })

    vi.advanceTimersByTime(STALL_MS)

    expect(stalls[0]?.[0]).toMatchObject({
      lastEvent: `afterAll of ${FILE} started`,
      stuck: null,
      orNext: null,
      lastFinished: 'Probe > Renders (passed)',
      finished: 1,
      total: 1,
    })
  })

  it('still reports the file when its tests cannot be read', () => {
    const module = {
      ...fakeModule(FILE, ['Renders']),
      children: {
        allTests: () => {
          throw new TypeError('allTests is gone')
        },
      },
    }
    guard.onTestModuleStart(module)

    vi.advanceTimersByTime(STALL_MS)

    expect(stalls[0]?.[0]).toMatchObject({
      file: FILE,
      stuck: null,
      unreadable: 'TypeError: allTests is gone',
    })
  })

  it('counts from the last update, not from the start of the file', () => {
    const module = fakeModule(FILE, ['Slow', 'Freezes'])
    guard.onTestModuleStart(module)
    vi.advanceTimersByTime(STALL_MS - 5_000)
    guard.onTestCaseReady(testNamed(module, 'Slow'))
    vi.advanceTimersByTime(STALL_MS - 5_000)

    expect(stalls).toEqual([])

    vi.advanceTimersByTime(5_000)

    expect(stalls[0]?.[0]).toMatchObject({
      quietMs: STALL_MS,
      runningMs: 2 * STALL_MS - 5_000,
      stuck: 'Probe > Slow',
    })
  })

  it('takes every hook and suite update as progress', () => {
    const module = fakeModule(FILE, ['Renders'])
    const test = testNamed(module, 'Renders')
    const suite = { type: 'suite', fullName: 'Probe', module } as const
    const events = [
      () => guard.onHookStart({ name: 'beforeAll', entity: module }),
      () => guard.onTestSuiteReady(suite),
      () => guard.onHookEnd({ name: 'beforeAll', entity: suite }),
      () => guard.onHookStart({ name: 'beforeEach', entity: test }),
      () => guard.onHookEnd({ name: 'afterEach', entity: test }),
      () => guard.onTestSuiteResult(suite),
    ]
    guard.onTestModuleStart(module)

    for (const event of events) {
      vi.advanceTimersByTime(STALL_MS - 1_000)
      event()
    }
    vi.advanceTimersByTime(STALL_MS - 1_000)

    expect(stalls).toEqual([])

    vi.advanceTimersByTime(1_000)

    expect(stalls[0]?.[0]).toMatchObject({ lastEvent: 'suite "Probe" finished' })
  })

  it('reports the quiet file and not the one still sending', () => {
    const quiet = fakeModule(FILE, ['Freezes'])
    const busy = fakeModule('src/components/ui/busy.stories.tsx', ['One', 'Two'])
    guard.onTestModuleStart(quiet)
    guard.onTestModuleStart(busy)
    vi.advanceTimersByTime(STALL_MS - 1_000)
    runTest(guard, busy, 'One')

    vi.advanceTimersByTime(1_000)

    expect(stalls.map((stalled) => stalled.map(({ file }) => file))).toEqual([[FILE]])
  })

  it('reports every file that is quiet at that moment', () => {
    guard.onTestModuleStart(fakeModule(FILE, ['Freezes']))
    guard.onTestModuleStart(fakeModule('src/components/ui/other.stories.tsx', ['Also']))

    vi.advanceTimersByTime(STALL_MS)

    expect(stalls.map((stalled) => stalled.map(({ file }) => file))).toEqual([
      [FILE, 'src/components/ui/other.stories.tsx'],
    ])
  })

  it('reports once, then stops watching', () => {
    guard.onTestModuleStart(fakeModule(FILE, ['Freezes']))

    vi.advanceTimersByTime(10 * STALL_MS)
    guard.check(performance.now() + 10 * STALL_MS)

    expect(stalls).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('forgets a file once it ends', () => {
    const module = fakeModule(FILE, ['Renders'])
    guard.onTestModuleStart(module)
    runTest(guard, module, 'Renders')
    guard.onTestModuleEnd(module)

    vi.advanceTimersByTime(10 * STALL_MS)

    expect(stalls).toEqual([])
  })

  it('stops its timer when the run ends', () => {
    guard.onTestModuleStart(fakeModule(FILE, ['Renders']))

    guard.onTestRunEnd()

    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(10 * STALL_MS)
    expect(stalls).toEqual([])
  })
})

describe('a quiet file whose page confirmed a story started', () => {
  let stalls: (readonly StalledFile[])[]
  let guard: StorybookStallGuard

  beforeEach(() => {
    vi.useFakeTimers()
    stalls = []
    guard = new StorybookStallGuard({ onStall: (stalled) => stalls.push(stalled) })
    guard.onTestRunStart()
  })

  afterEach(() => {
    guard.onTestRunEnd()
    vi.useRealTimers()
  })

  it('names that story alone when it had not finished', () => {
    const module = fakeModule(FILE, ['Renders', 'Freezes', 'After'])
    guard.onTestModuleStart(module)
    confirmStarted(module, 'Renders')
    runTest(guard, module, 'Renders')
    confirmStarted(module, 'Freezes')

    vi.advanceTimersByTime(STALL_MS)

    expect(stalls).toEqual([
      [
        {
          file: FILE,
          quietMs: STALL_MS,
          runningMs: STALL_MS,
          lastEvent: 'page confirmed "Probe > Freezes" started',
          stuck: 'Probe > Freezes',
          startConfirmed: true,
          orNext: null,
          lastFinished: 'Probe > Renders (passed)',
          finished: 1,
          total: 3,
          unreadable: null,
        },
      ],
    ])
  })

  it('names it when the batch saying the story before it finished never came', () => {
    // The probe story's CI shape: the last batch had the story before it
    // ending its beforeEach. The probe confirmed it started, so that story
    // had finished, in the batch that never came.
    const module = fakeModule(FILE, ['Renders', 'Freezes', 'After'])
    const renders = testNamed(module, 'Renders')
    guard.onTestModuleStart(module)
    confirmStarted(module, 'Renders')
    guard.onTestCaseReady(renders)
    guard.onHookEnd({ name: 'beforeEach', entity: renders })
    confirmStarted(module, 'Freezes')

    vi.advanceTimersByTime(STALL_MS)

    expect(stalls[0]?.[0]).toMatchObject({
      stuck: 'Probe > Freezes',
      startConfirmed: true,
      orNext: null,
      lastFinished: null,
      finished: 0,
    })
  })

  it('names the next story as not started when the confirmed one had finished', () => {
    // It froze in the confirmed story's afterEach or the next one's setup:
    // the next story never got to render, so the one after it is no candidate.
    const module = fakeModule(FILE, ['Renders', 'Freezes', 'After'])
    const renders = testNamed(module, 'Renders')
    guard.onTestModuleStart(module)
    confirmStarted(module, 'Renders')
    runTest(guard, module, 'Renders')
    guard.onHookStart({ name: 'afterEach', entity: renders })

    vi.advanceTimersByTime(STALL_MS)

    expect(stalls[0]?.[0]).toMatchObject({
      lastEvent: 'afterEach of "Probe > Renders" started',
      stuck: 'Probe > Freezes',
      startConfirmed: false,
      orNext: null,
      lastFinished: 'Probe > Renders (passed)',
    })
  })

  it("names the file's teardown when the confirmed story was its last, and finished", () => {
    const module = fakeModule(FILE, ['Renders'])
    guard.onTestModuleStart(module)
    confirmStarted(module, 'Renders')
    runTest(guard, module, 'Renders')

    vi.advanceTimersByTime(STALL_MS)

    expect(stalls[0]?.[0]).toMatchObject({
      stuck: null,
      startConfirmed: null,
      orNext: null,
      lastFinished: 'Probe > Renders (passed)',
    })
  })

  it('keeps a confirmation that comes before the batch saying its file started', () => {
    const module = fakeModule(FILE, ['Freezes', 'After'])
    confirmStarted(module, 'Freezes')
    guard.onTestModuleStart(module)

    vi.advanceTimersByTime(STALL_MS)

    expect(stalls[0]?.[0]).toMatchObject({
      lastEvent: 'file started',
      stuck: 'Probe > Freezes',
      startConfirmed: true,
    })
  })

  it('counts a confirmation as an update', () => {
    const module = fakeModule(FILE, ['Freezes'])
    guard.onTestModuleStart(module)
    vi.advanceTimersByTime(STALL_MS - 1_000)
    confirmStarted(module, 'Freezes')
    vi.advanceTimersByTime(STALL_MS - 1_000)

    expect(stalls).toEqual([])

    vi.advanceTimersByTime(1_000)

    expect(stalls[0]?.[0]).toMatchObject({
      quietMs: STALL_MS,
      runningMs: 2 * STALL_MS - 1_000,
      stuck: 'Probe > Freezes',
    })
  })

  it('goes by the states when the confirmed story is not one of the file', () => {
    const module = fakeModule(FILE, ['Renders', 'Freezes'])
    guard.onTestModuleStart(module)
    announceStoryStart({ fileId: module.id, testId: 'another-files-story' })

    vi.advanceTimersByTime(STALL_MS)

    expect(stalls[0]?.[0]).toMatchObject({
      lastEvent: 'page confirmed another-files-story started',
      stuck: 'Probe > Renders',
      startConfirmed: null,
      orNext: 'Probe > Freezes',
    })
  })

  it('hears no confirmation once its run has ended', () => {
    const module = fakeModule(FILE, ['Freezes'])
    guard.onTestRunEnd()
    guard.onTestModuleStart(module)
    confirmStarted(module, 'Freezes')

    vi.advanceTimersByTime(STALL_MS)

    expect(stalls[0]?.[0]).toMatchObject({
      lastEvent: 'file started',
      startConfirmed: null,
    })
  })

  it("forgets its last run's confirmations when a new run starts", () => {
    const module = fakeModule(FILE, ['Freezes'])
    confirmStarted(module, 'Freezes')
    guard.onTestRunEnd()
    guard.onTestRunStart()
    guard.onTestModuleStart(module)

    vi.advanceTimersByTime(STALL_MS)

    expect(stalls[0]?.[0]).toMatchObject({
      stuck: 'Probe > Freezes',
      startConfirmed: null,
    })
  })
})

describe('the report', () => {
  const stuck: StalledFile = {
    file: FILE,
    quietMs: 45_400,
    runningMs: 52_600,
    lastEvent: 'beforeEach of "Probe > Renders" ended',
    stuck: 'Probe > Renders',
    startConfirmed: null,
    orNext: 'Probe > Freezes',
    lastFinished: null,
    finished: 0,
    total: 3,
    unreadable: null,
  }
  const confirmed: StalledFile = {
    ...stuck,
    lastEvent: 'page confirmed "Probe > Freezes" started',
    stuck: 'Probe > Freezes',
    startConfirmed: true,
    orNext: null,
  }

  it('names the file, where it most likely froze, and its last update', () => {
    expect(describeStalls([stuck])).toBe(
      [
        `Storybook stall guard: ${FILE} sent no update for 45 s (running 53 s, 0 of 3 tests reported finished).`,
        '  Stuck in:      Probe > Renders, or the story after it, Probe > Freezes',
        '  Last finished: none reported',
        '  Last update:   beforeEach of "Probe > Renders" ended',
        "Each story's page confirms it started, and waits for the answer, before the story renders.",
        'Without a confirmation the guard goes by the batches a page sends its other updates in, at',
        'most one per 100 ms, and a frozen page never sends its last one: the stuck story is then',
        'the first it had not reported finished, or the next.',
        "A frozen page runs no JavaScript, so Vitest's own test timeout cannot fire there.",
        'Failing the run now instead of waiting for the job timeout.',
      ].join('\n'),
    )
  })

  it('names the story its page confirmed started, alone', () => {
    expect(describeStalls([confirmed])).toContain(
      [
        '  Stuck in:      Probe > Freezes (its page confirmed it started)',
        '  Last finished: none reported',
        '  Last update:   page confirmed "Probe > Freezes" started',
      ].join('\n'),
    )
  })

  it('says when the page froze before the stuck story started', () => {
    expect(describeStalls([{ ...confirmed, startConfirmed: false }])).toContain(
      '  Stuck in:      Probe > Freezes, before its page confirmed it started\n',
    )
  })

  it('names the teardown when no story is left', () => {
    expect(describeStalls([{ ...stuck, orNext: null }])).toContain(
      "  Stuck in:      Probe > Renders, or the file's teardown after it\n",
    )
    expect(describeStalls([{ ...stuck, stuck: null, orNext: null }])).toContain(
      "  Stuck in:      the file's teardown, after its last story\n",
    )
  })

  it('says when its tests could not be read', () => {
    const report = describeStalls([
      { ...stuck, stuck: null, orNext: null, unreadable: 'TypeError: allTests is gone' },
    ])

    expect(report).toContain(`${FILE} sent no update for 45 s (running 53 s).\n`)
    expect(report).toContain(
      '  Stuck in:      unknown, its tests could not be read (TypeError: allTests is gone)\n',
    )
  })

  it('is a GitHub error annotation on the file, with its text escaped', () => {
    expect(
      stallAnnotation({
        ...stuck,
        file: 'src/a,b:c.stories.tsx',
        stuck: 'Probe > 100% done\nnext',
      }),
    ).toBe(
      '::error file=src/a%2Cb%3Ac.stories.tsx,title=Storybook stall::' +
        'Stuck in Probe > 100%25 done%0Anext, or the story after it, Probe > Freezes: ' +
        'the file sent no update for 45 s.',
    )
  })

  it('names the confirmed story alone in the annotation too', () => {
    expect(stallAnnotation(confirmed)).toBe(
      `::error file=${FILE},title=Storybook stall::` +
        'Stuck in Probe > Freezes (its page confirmed it started): ' +
        'the file sent no update for 45 s.',
    )
  })
})

type Exited = Readonly<{ code: number | null; stdout: string; stderr: string }>

function isExecFailure(
  error: unknown,
): error is Readonly<{ code?: unknown; stdout: string; stderr: string }> {
  return (
    typeof error === 'object' && error !== null && 'stdout' in error && 'stderr' in error
  )
}

/** Runs `script` as an ES module in a fresh Node, with the guard importable. */
async function runScript(script: string, env: NodeJS.ProcessEnv): Promise<Exited> {
  try {
    const { stdout, stderr } = await runNode(
      process.execPath,
      ['--input-type=module', '--no-warnings', '-e', script],
      { env, timeout: 15_000 },
    )
    return { code: 0, stdout, stderr }
  } catch (error) {
    if (!isExecFailure(error)) throw error
    const code = typeof error.code === 'number' ? error.code : null
    return { code, stdout: error.stdout, stderr: error.stderr }
  }
}

// One started file with one test still running, as a frozen page leaves it.
const startStuckFile = [
  `const { default: Guard } = await import(${JSON.stringify(GUARD_URL)})`,
  "const module = { type: 'module', id: 'm', relativeModuleId: 'src/a.stories.tsx',",
  "  children: { allTests: () => [{ type: 'test', fullName: 'A > Freezes', module,",
  "    result: () => ({ state: 'pending' }) }] } }",
].join('\n')

describe('in a process of its own', () => {
  it('lets the process exit: the guard alone keeps nothing alive', async () => {
    // A started file and no run end, as when Vitest dies mid-run.
    const exited = await runScript(
      [
        startStuckFile,
        'new Guard({ onStall: () => process.exit(3) }).onTestModuleStart(module)',
      ].join('\n'),
      process.env,
    )

    expect(exited).toEqual({ code: 0, stdout: '', stderr: '' })
  })

  it.each([
    { env: 'true', annotated: true },
    { env: 'false', annotated: false },
  ])(
    'fails the run with the report, annotating it when GITHUB_ACTIONS is $env',
    async ({ env, annotated }) => {
      // Something else keeps the process alive, as Vitest's server does.
      const exited = await runScript(
        [
          startStuckFile,
          'new Guard({ stallMs: 300 }).onTestModuleStart(module)',
          'setTimeout(() => process.exit(5), 10_000)',
        ].join('\n'),
        { ...process.env, GITHUB_ACTIONS: env },
      )

      expect(exited.code).toBe(1)
      expect(exited.stderr).toContain(
        'Storybook stall guard: src/a.stories.tsx sent no update for ',
      )
      expect(exited.stderr).toContain('  Stuck in:      A > Freezes, or the file')
      expect(
        exited.stderr.includes('::error file=src/a.stories.tsx,title=Storybook stall::'),
      ).toBe(annotated)
    },
  )
})

describe('in a real Vitest run', () => {
  let root = ''
  let checked = ''
  let started = ''

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'stall-guard-')))
    checked = join(root, 'checked')
    started = join(root, 'started.json')
    // `waits` stands in for a story whose page froze. It runs until the
    // reporter below has checked, so it cannot finish first. The update that
    // says it started must reach the reporter while it runs, and Vitest's
    // 100 ms batching can hold an update until the next one; the end of a
    // beforeEach longer than a batch always sends at once. That beforeEach
    // first writes down the task ids `waits` sees, which a story's page sends
    // through the browser command.
    await writeFile(
      join(root, 'quiet.test.ts'),
      [
        "import { existsSync, writeFileSync } from 'node:fs'",
        'const sleep = (ms) => new Promise((settle) => setTimeout(settle, ms))',
        'beforeEach(async ({ task }) => {',
        "  if (task.name !== 'waits') return",
        `  writeFileSync(${JSON.stringify(started)}, JSON.stringify({ fileId: task.file.id, testId: task.id }))`,
        '  await sleep(150)',
        '})',
        "test('renders', () => {})",
        "test('waits', async () => {",
        `  for (let i = 0; i < 500 && !existsSync(${JSON.stringify(checked)}); i++) await sleep(20)`,
        '})',
        "test('runs after', () => {})",
      ].join('\n'),
    )
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('hears the updates it needs from Vitest, and loads from its path', async () => {
    const stalls: (readonly StalledFile[])[] = []
    const fromPath: (readonly StalledFile[])[] = []
    // Checks as if the threshold had passed the moment `waits` was reported
    // started, so what it reads is what Vitest had delivered by then, with no
    // race against the clock; then lets `waits` finish.
    class CheckWhenWaiting extends StorybookStallGuard {
      override onTestCaseReady(
        test: Parameters<StorybookStallGuard['onTestCaseReady']>[0],
      ): void {
        super.onTestCaseReady(test)
        if (test.fullName !== 'waits') return
        this.check(performance.now() + 2 * STALL_MS)
        writeFileSync(checked, '')
      }
    }
    const loaded: StallGuardOptions = { onStall: (stalled) => fromPath.push(stalled) }
    const vitest = await createVitest('test', {
      root,
      config: false,
      globals: true,
      watch: false,
      cache: false,
      include: ['*.test.ts'],
      reporters: [
        new CheckWhenWaiting({ onStall: (stalled) => stalls.push(stalled) }),
        [GUARD, loaded],
      ],
    })
    try {
      await vitest.start()
    } finally {
      await vitest.close()
    }

    expect(stalls).toEqual([
      [
        expect.objectContaining({
          file: 'quiet.test.ts',
          lastEvent: 'test "waits" started',
          stuck: 'waits',
          startConfirmed: null,
          orNext: 'runs after',
          lastFinished: 'renders (passed)',
          finished: 1,
          total: 3,
        }),
      ],
    ])
    expect(fromPath).toEqual([])
  })

  it('hears a story confirm it started, by the task ids the story sees', async () => {
    const stalls: (readonly StalledFile[])[] = []
    // Once the beforeEach of `waits` has ended, its ids are written down: sends
    // them as the story's page would, checks as if the threshold had passed,
    // and lets `waits` finish. The guard hears them only if Vitest started its
    // run, and names `waits` alone only if the ids are the reporters' ones.
    class ConfirmThenCheck extends StorybookStallGuard {
      override onHookEnd(hook: Parameters<StorybookStallGuard['onHookEnd']>[0]): void {
        super.onHookEnd(hook)
        if (hook.name !== 'beforeEach' || hook.entity.type !== 'test') return
        if (hook.entity.fullName !== 'waits') return
        announceStoryStart(JSON.parse(readFileSync(started, 'utf8')))
        this.check(performance.now() + 2 * STALL_MS)
        writeFileSync(checked, '')
      }
    }
    const vitest = await createVitest('test', {
      root,
      config: false,
      globals: true,
      watch: false,
      cache: false,
      include: ['*.test.ts'],
      reporters: [new ConfirmThenCheck({ onStall: (stalled) => stalls.push(stalled) })],
    })
    try {
      await vitest.start()
    } finally {
      await vitest.close()
    }

    expect(stalls).toEqual([
      [
        expect.objectContaining({
          file: 'quiet.test.ts',
          lastEvent: 'page confirmed "waits" started',
          stuck: 'waits',
          startConfirmed: true,
          orNext: null,
          lastFinished: 'renders (passed)',
        }),
      ],
    ])
  })
})
