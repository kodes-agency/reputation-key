// The storybook stall guard, driven two ways. Reporter events from small
// stand-ins for Vitest's TestModule and TestCase, under fake timers, pin down
// what it reports and when: only a started file that has gone quiet, measured
// from its last event, once. One real Vitest run then checks that the events
// it listens for are the ones Vitest sends, and that Vitest can load it from
// its path the way the storybook-test job does, so a Vitest upgrade that
// renames them fails here instead of leaving the guard watching nothing.

import { execFile } from 'node:child_process'
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
  for (const name of names) {
    const test: FakeTest = {
      type: 'test',
      id: `${file}:${name}`,
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

  it('names the file, the last test that finished and the one in flight', () => {
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
          lastFinished: 'Probe > Renders (passed)',
          likelyStuck: { test: 'Probe > Freezes', started: true },
          finished: 1,
          total: 3,
        },
      ],
    ])
  })

  it('names the next test when the stuck one was never reported started', () => {
    const module = fakeModule(FILE, ['Renders', 'Freezes', 'After'])
    guard.onTestModuleStart(module)
    runTest(guard, module, 'Renders', 'failed')

    vi.advanceTimersByTime(STALL_MS)

    expect(stalls[0]?.[0]).toMatchObject({
      lastEvent: 'test "Probe > Renders" failed',
      lastFinished: 'Probe > Renders (failed)',
      likelyStuck: { test: 'Probe > Freezes', started: false },
    })
  })

  it('reads the stuck test from the states when the last events never came', () => {
    // As the probe story froze: the page had sent the first story's state as
    // passed, and that its afterEach started, but not that it finished nor
    // that the second one started.
    const module = fakeModule(FILE, ['Renders', 'Freezes', 'After'])
    const renders = testNamed(module, 'Renders')
    guard.onTestModuleStart(module)
    guard.onTestCaseReady(renders)
    renders.state = 'passed'
    guard.onHookStart({ name: 'afterEach', entity: renders })

    vi.advanceTimersByTime(STALL_MS)

    expect(stalls[0]?.[0]).toMatchObject({
      lastEvent: 'afterEach of "Probe > Renders" started',
      lastFinished: 'Probe > Renders (passed)',
      likelyStuck: { test: 'Probe > Freezes', started: false },
      finished: 1,
    })
  })

  it('passes over a skipped test for the last one that finished', () => {
    const module = fakeModule(FILE, ['Renders', 'Skipped', 'Freezes'])
    guard.onTestModuleStart(module)
    runTest(guard, module, 'Renders')
    testNamed(module, 'Skipped').state = 'skipped'

    vi.advanceTimersByTime(STALL_MS)

    expect(stalls[0]?.[0]).toMatchObject({
      lastFinished: 'Probe > Renders (passed)',
      likelyStuck: { test: 'Probe > Freezes', started: false },
      finished: 2,
      total: 3,
    })
  })

  it('names the first test when none has finished', () => {
    const module = fakeModule(FILE, ['Freezes', 'After'])
    guard.onTestModuleStart(module)

    vi.advanceTimersByTime(STALL_MS)

    expect(stalls[0]?.[0]).toMatchObject({
      lastEvent: 'file started',
      lastFinished: null,
      likelyStuck: { test: 'Probe > Freezes', started: false },
      finished: 0,
      total: 2,
    })
  })

  it('names no test when every test had finished', () => {
    const module = fakeModule(FILE, ['Renders'])
    guard.onTestModuleStart(module)
    runTest(guard, module, 'Renders')
    guard.onHookStart({ name: 'afterAll', entity: module })

    vi.advanceTimersByTime(STALL_MS)

    expect(stalls[0]?.[0]).toMatchObject({
      lastEvent: `afterAll of ${FILE} started`,
      lastFinished: 'Probe > Renders (passed)',
      likelyStuck: null,
      finished: 1,
      total: 1,
    })
  })

  it('counts from the last event, not from the start of the file', () => {
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
      likelyStuck: { test: 'Probe > Slow', started: true },
    })
  })

  it('takes every hook and suite event as progress', () => {
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

  it('reports the quiet file and not the one still reporting', () => {
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

describe('a run that never ends its way', () => {
  it('lets the process exit: the guard alone keeps nothing alive', async () => {
    // A started file and no run end, as when Vitest dies mid-run: the process
    // must still exit on its own rather than wait on the guard's timer.
    const script = [
      `const { default: Guard } = await import(${JSON.stringify(GUARD_URL)})`,
      'const guard = new Guard({ onStall: () => process.exit(3) })',
      "guard.onTestModuleStart({ type: 'module', id: 'm', relativeModuleId: 'm.stories.tsx',",
      '  children: { allTests: () => [] } })',
    ].join('\n')

    // Rejects when the child exits non-zero or is killed for outliving the timeout.
    const exited = await runNode(
      process.execPath,
      ['--input-type=module', '-e', script],
      {
        timeout: 10_000,
      },
    )

    expect(exited.stdout).toBe('')
  })
})

describe('the report', () => {
  const stuck: StalledFile = {
    file: FILE,
    quietMs: 45_400,
    runningMs: 52_600,
    lastEvent: 'test "Probe > Freezes" started',
    lastFinished: 'Probe > Renders (passed)',
    likelyStuck: { test: 'Probe > Freezes', started: true },
    finished: 1,
    total: 3,
  }

  it('names the file, the last test that finished and the likely stuck one', () => {
    expect(describeStalls([stuck])).toBe(
      [
        `Storybook stall guard: ${FILE} reported nothing for 45 s (running 53 s, 1 of 3 tests finished).`,
        '  Last finished: Probe > Renders (passed)',
        '  Likely stuck:  Probe > Freezes (started, never finished)',
        '  Last event:    test "Probe > Freezes" started',
        "A frozen story page runs no JavaScript, so Vitest's own test timeout cannot fire there.",
        'Failing the run now instead of waiting for the job timeout.',
      ].join('\n'),
    )
  })

  it('says when the likely stuck test is only the next one in the file', () => {
    const report = describeStalls([
      {
        ...stuck,
        lastFinished: null,
        likelyStuck: { test: 'Probe > Renders', started: false },
      },
    ])

    expect(report).toContain('  Last finished: none yet\n')
    expect(report).toContain(
      '  Likely stuck:  Probe > Renders (next in the file; its start was never reported)\n',
    )
  })

  it('says when the file went quiet after its last test', () => {
    expect(describeStalls([{ ...stuck, likelyStuck: null }])).toContain(
      '  Likely stuck:  none left: the file went quiet after its last test\n',
    )
  })

  it('is a GitHub error annotation on the file, with its text escaped', () => {
    expect(
      stallAnnotation({
        ...stuck,
        file: 'src/a,b:c.stories.tsx',
        likelyStuck: { test: 'Probe > 100% done\nnext', started: true },
      }),
    ).toBe(
      '::error file=src/a%2Cb%3Ac.stories.tsx,title=Storybook stall::' +
        'Probe > 100%25 done%0Anext froze: its file reported nothing for 45 s. ' +
        'Last finished: Probe > Renders (passed).',
    )
  })
})

describe('in a real Vitest run', () => {
  let root = ''

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'stall-guard-')))
    // The second test stays quiet for longer than the threshold below, which is
    // all the guard can see of a frozen page, and then passes, so the run ends
    // green and the guard must already have reported it.
    await writeFile(
      join(root, 'quiet.test.ts'),
      [
        "test('renders', () => {})",
        "test('goes quiet', () => new Promise((settle) => setTimeout(settle, 2_000)))",
        "test('runs after', () => {})",
      ].join('\n'),
    )
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('hears the events it needs from Vitest, loaded from its path', async () => {
    const stalls: (readonly StalledFile[])[] = []
    const options: StallGuardOptions = {
      stallMs: 500,
      onStall: (stalled) => stalls.push(stalled),
    }
    const vitest = await createVitest('test', {
      root,
      config: false,
      globals: true,
      watch: false,
      cache: false,
      include: ['*.test.ts'],
      reporters: [[GUARD, options]],
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
          lastFinished: 'renders (passed)',
          likelyStuck: { test: 'goes quiet', started: true },
          total: 3,
        }),
      ],
    ])
  })
})
