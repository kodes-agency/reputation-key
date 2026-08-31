import { describe, expect, it, vi } from 'vitest'
import { createWorkerProcessFailurePolicy } from './process-failure'

function deferred(): {
  promise: Promise<void>
  resolve: () => void
} {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function harness(
  shutdown: (trigger: string, exitCode: 0 | 1) => Promise<void> = vi.fn(
    async () => undefined,
  ),
) {
  return {
    shutdown,
    exit: vi.fn(),
    logger: { fatal: vi.fn() },
    captureFatal: vi.fn(),
    flushErrorMonitoring: vi.fn(async () => true),
  }
}

describe('worker process failure policy', () => {
  it.each(['SIGTERM', 'SIGINT'] as const)(
    'drains %s as a clean termination',
    async (signal) => {
      const deps = harness()
      const policy = createWorkerProcessFailurePolicy(deps)

      policy.onSignal(signal)

      await vi.waitFor(() => expect(deps.shutdown).toHaveBeenCalledWith(signal, 0))
      expect(deps.logger.fatal).not.toHaveBeenCalled()
      expect(deps.exit).not.toHaveBeenCalled()
    },
  )

  it('treats an unhandled rejection as fatal and does not log a primitive reason', async () => {
    const deps = harness()
    const policy = createWorkerProcessFailurePolicy(deps)

    policy.onUnhandledRejection('redis://user:secret@example.invalid')

    await vi.waitFor(() =>
      expect(deps.shutdown).toHaveBeenCalledWith('unhandledRejection', 1),
    )
    expect(deps.logger.fatal).toHaveBeenCalledWith(
      {
        err: expect.objectContaining({ name: 'Error' }),
        trigger: 'unhandledRejection',
      },
      'Fatal worker process error — starting bounded drain',
    )
    expect(JSON.stringify(deps.logger.fatal.mock.calls)).not.toContain('secret')
    expect(deps.captureFatal).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Non-Error rejection' }),
      'unhandledRejection',
    )
    expect(JSON.stringify(deps.captureFatal.mock.calls)).not.toContain('secret')
  })

  it('treats an uncaught exception as fatal', async () => {
    const deps = harness()
    const policy = createWorkerProcessFailurePolicy(deps)
    const error = new Error('processor failed')

    policy.onUncaughtException(error)

    await vi.waitFor(() =>
      expect(deps.shutdown).toHaveBeenCalledWith('uncaughtException', 1),
    )
    expect(deps.logger.fatal).toHaveBeenCalledWith(
      { err: error, trigger: 'uncaughtException' },
      'Fatal worker process error — starting bounded drain',
    )
    expect(deps.captureFatal).toHaveBeenCalledWith(error, 'uncaughtException')
  })

  it('allows only the first termination path to own shutdown', async () => {
    const pending = deferred()
    const deps = harness(vi.fn(() => pending.promise))
    const policy = createWorkerProcessFailurePolicy(deps)

    policy.onSignal('SIGTERM')
    policy.onUnhandledRejection(new Error('late rejection'))
    policy.onSignal('SIGINT')

    expect(deps.shutdown).toHaveBeenCalledTimes(1)
    expect(deps.shutdown).toHaveBeenCalledWith('SIGTERM', 0)
    pending.resolve()
  })

  it('forces a non-zero exit if the shutdown implementation rejects', async () => {
    const deps = harness(vi.fn(async () => Promise.reject(new Error('drain broke'))))
    const policy = createWorkerProcessFailurePolicy(deps)

    policy.onUnhandledRejection(new Error('first failure'))

    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(1))
    expect(deps.captureFatal).toHaveBeenLastCalledWith(expect.any(Error), 'shutdown')
    expect(deps.flushErrorMonitoring).toHaveBeenCalledOnce()
    expect(deps.logger.fatal).toHaveBeenLastCalledWith(
      { err: expect.any(Error), trigger: 'unhandledRejection' },
      'Worker shutdown failed — forcing non-zero exit',
    )
  })
})
