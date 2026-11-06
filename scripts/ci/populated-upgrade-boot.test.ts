import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootUpgradeImage } from './populated-upgrade-images'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))

afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})

type WorkerBootOutcome =
  'ready' | 'exited' | 'failed' | 'late-exit' | 'late-failure' | 'stalled'

function workerState(outcome: WorkerBootOutcome, elapsed: number, args: string[]) {
  if (args.includes('{{.State.ExitCode}}')) return '1'
  return (outcome === 'exited' && elapsed >= 1_000) ||
    (outcome === 'late-exit' && elapsed >= 2_000)
    ? 'false'
    : 'true'
}

function workerLogs(outcome: WorkerBootOutcome, elapsed: number) {
  const messages = [{ msg: 'BullMQ worker started on default queue' }]
  if (elapsed >= 1_000 && ['ready', 'late-exit', 'late-failure'].includes(outcome))
    messages.push({ msg: 'Outbox relay started' })
  if (
    (elapsed >= 1_000 && outcome === 'failed') ||
    (elapsed >= 2_000 && outcome === 'late-failure')
  )
    messages.push({ msg: 'Worker failed to start' })
  return messages.map((message) => JSON.stringify(message)).join('\n')
}

function workerBoot(outcome: WorkerBootOutcome, webStarting = false) {
  vi.useFakeTimers()
  const startedAt = Date.now()
  const removed: string[] = []
  let webProbes = 0
  vi.mocked(execFileSync).mockImplementation((_command, args) => {
    const [operation, ...rest] = args as string[]
    if (operation === 'run')
      return rest.includes('dist-worker/index.js') ? 'worker' : 'web'
    if (operation === 'rm') {
      removed.push(rest.at(-1)!)
      return ''
    }
    if (operation === 'exec') {
      if (webStarting && webProbes++ === 0) throw new Error('Connection refused')
      return JSON.stringify({
        status: 200,
        body: Object.fromEntries(
          ['container', 'keys', 'db', 'redis', 'migrations', 'policy'].map((key) => [
            key,
            true,
          ]),
        ),
      })
    }
    const elapsed = Date.now() - startedAt
    if (operation === 'inspect') return workerState(outcome, elapsed, rest)
    if (operation === 'logs') return workerLogs(outcome, elapsed)
    throw new Error(`Unexpected Docker operation ${operation}`)
  })
  return { removed }
}

describe('upgrade worker startup', () => {
  it.each(['exited', 'failed', 'late-exit', 'late-failure', 'stalled'] as const)(
    'rejects startup that %s after the default queue starts',
    async (outcome) => {
      const { removed } = workerBoot(outcome)
      const result = bootUpgradeImage(
        'candidate',
        'postgresql://test:test@localhost/test_upgrade',
      )
      await Promise.all([
        expect(result).rejects.toThrow(/Upgrade worker image/u),
        vi.runAllTimersAsync(),
      ])
      expect(removed).toEqual(['web', 'worker'])
    },
  )

  it('keeps the container until initialization finishes and it is still running', async () => {
    const { removed } = workerBoot('ready')
    const result = bootUpgradeImage(
      'candidate',
      'postgresql://test:test@localhost/test_upgrade',
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(removed).toEqual(['web'])
    await vi.runAllTimersAsync()
    await result
    expect(removed).toEqual(['web', 'worker'])
  })

  it('still retries while the web process is starting to listen', async () => {
    const { removed } = workerBoot('ready', true)
    const result = bootUpgradeImage(
      'candidate',
      'postgresql://test:test@localhost/test_upgrade',
    )
    await Promise.all([expect(result).resolves.toBeUndefined(), vi.runAllTimersAsync()])
    expect(removed).toEqual(['web', 'worker'])
  })
})
