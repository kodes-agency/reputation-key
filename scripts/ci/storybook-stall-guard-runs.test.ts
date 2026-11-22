// The storybook stall guard run for real. A child process runs its default
// ending: the report, the annotation, exit 1, and no timer that holds a
// process open. Two real Vitest runs check that the updates it listens for are
// the ones Vitest sends, that it listens for story starts during a run, by the
// task ids a test itself sees, and that Vitest can load it from its path as the
// storybook-test job does, so a Vitest upgrade that renames them fails here
// instead of leaving the guard watching nothing.

import { execFile } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { createVitest } from 'vitest/node'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import StorybookStallGuard, {
  STALL_MS,
  type StalledFile,
  type StallGuardOptions,
} from './storybook-stall-guard'
import { announceStoryStart } from './storybook-story-starts'

const GUARD = resolve(import.meta.dirname, 'storybook-stall-guard.ts')
const GUARD_URL = pathToFileURL(GUARD).href
const runNode = promisify(execFile)

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

/** Runs the `*.test.ts` files in `root` once under real Vitest with `reporters`. */
async function runQuietFile(
  root: string,
  reporters: NonNullable<Parameters<typeof createVitest>[1]['reporters']>,
): Promise<void> {
  const vitest = await createVitest('test', {
    root,
    config: false,
    globals: true,
    watch: false,
    cache: false,
    include: ['*.test.ts'],
    reporters,
  })
  try {
    await vitest.start()
  } finally {
    await vitest.close()
  }
}

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
    // beforeEach longer than a batch always sends at once. Before `waits`
    // starts, `renders` writes down its task ids, the ones a story's page
    // sends through the browser command as `task.file.id` and `task.id`.
    await writeFile(
      join(root, 'quiet.test.ts'),
      [
        "import { existsSync, writeFileSync } from 'node:fs'",
        'const sleep = (ms) => new Promise((settle) => setTimeout(settle, ms))',
        "beforeEach(async ({ task }) => { if (task.name === 'waits') await sleep(150) })",
        "test('renders', ({ task }) => {",
        "  const waits = task.file.tasks.find((test) => test.name === 'waits')",
        `  writeFileSync(${JSON.stringify(started)}, JSON.stringify({ fileId: waits.file.id, testId: waits.id }))`,
        '})',
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
    await runQuietFile(root, [
      new CheckWhenWaiting({ onStall: (stalled) => stalls.push(stalled) }),
      [GUARD, loaded],
    ])

    expect(stalls).toEqual([
      [
        expect.objectContaining({
          file: 'quiet.test.ts',
          lastEvent: 'test "waits" started',
          stuck: 'waits',
          confirmed: null,
          orNext: 'runs after',
          lastFinished: 'renders (passed)',
          finished: 1,
          total: 3,
        }),
      ],
    ])
    expect(fromPath).toEqual([])
  })

  it('hears a story confirm it started, by the task ids the test runner gives it', async () => {
    const stalls: (readonly StalledFile[])[] = []
    // When `waits` is reported started, sends its ids as the story's page
    // would, checks as if the threshold had passed, and lets `waits` finish.
    // The guard hears them only if Vitest started its run, and names `waits`
    // alone only if they are the ids its reporters see.
    class ConfirmThenCheck extends StorybookStallGuard {
      override onTestCaseReady(
        test: Parameters<StorybookStallGuard['onTestCaseReady']>[0],
      ): void {
        super.onTestCaseReady(test)
        if (test.fullName !== 'waits') return
        announceStoryStart(JSON.parse(readFileSync(started, 'utf8')))
        this.check(performance.now() + 2 * STALL_MS)
        writeFileSync(checked, '')
      }
    }
    await runQuietFile(root, [
      new ConfirmThenCheck({ onStall: (stalled) => stalls.push(stalled) }),
    ])

    expect(stalls).toEqual([
      [
        expect.objectContaining({
          file: 'quiet.test.ts',
          lastEvent: 'page confirmed "waits" started',
          stuck: 'waits',
          confirmed: 'started',
          orNext: null,
          lastFinished: 'renders (passed)',
        }),
      ],
    ])
  })
})
