import { describe, expect, it, vi } from 'vitest'
import type { SidecarLifecycleEvent } from './process-lifecycle'
import {
  registerSidecarOperationalLifecycle,
  runSidecarStartup,
} from './sidecar-operational-runtime'

type Listener = (...arguments_: unknown[]) => void

function processTarget() {
  const listeners = new Map<string, Listener>()
  return {
    listeners,
    once: vi.fn((event: string, listener: Listener) => {
      listeners.set(event, listener)
    }),
    exit: vi.fn(),
  }
}

describe('sidecar operational runtime', () => {
  it('initializes monitoring before loading the protected runtime', async () => {
    const order: string[] = []

    await runSidecarStartup(
      'ai-egress-gateway',
      async () => {
        order.push('runtime')
      },
      {
        initialize: vi.fn(() => {
          order.push('monitoring')
          return 'disabled' as const
        }),
        capture: vi.fn(),
        flush: vi.fn(async () => true),
      },
    )

    expect(order).toEqual(['monitoring', 'runtime'])
  })

  it('adopts the Railway git revision as RELEASE_SHA before monitoring starts', async () => {
    vi.stubEnv('RELEASE_SHA', '')
    vi.stubEnv('RAILWAY_GIT_COMMIT_SHA', '7aabe93ac8933626ca848cc09f8e46d405c476f4')
    let releaseAtInitialize: string | undefined
    try {
      await runSidecarStartup('ai-execution-admission', async () => {}, {
        initialize: vi.fn(() => {
          releaseAtInitialize = process.env.RELEASE_SHA
          return 'enabled' as const
        }),
        capture: vi.fn(),
        flush: vi.fn(async () => true),
      })
    } finally {
      vi.unstubAllEnvs()
    }
    expect(releaseAtInitialize).toBe('7aabe93ac8933626ca848cc09f8e46d405c476f4')
  })

  it('captures, flushes, and terminates without rethrowing startup content', async () => {
    const failure = new Error('sensitive startup detail')
    const termination = new Error('test termination')
    const capture = vi.fn()
    const flush = vi.fn(async () => true)
    const terminate = vi.fn(() => {
      throw termination
    })

    await expect(
      runSidecarStartup(
        'ai-execution-admission',
        async () => {
          throw failure
        },
        {
          initialize: vi.fn(() => 'enabled' as const),
          capture,
          flush,
          terminate,
        },
      ),
    ).rejects.toBe(termination)

    expect(capture).toHaveBeenCalledWith(failure, {
      source: 'sidecar-startup',
      trigger: 'startup',
    })
    expect(flush).toHaveBeenCalledOnce()
    expect(terminate).toHaveBeenCalledWith(1)
  })

  it('says why on stderr even when the monitoring client is switched off', async () => {
    // The regression this exists for: the Google sidecars' capture is a no-op
    // outside a deployed cell, so a startup failure produced an exit 1 with
    // nothing to read, and compose reported only `dependency failed to start`.
    const written: string[] = []
    const write = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        written.push(String(chunk))
        return true
      })
    try {
      await expect(
        runSidecarStartup(
          'ai-execution-admission',
          async () => {
            throw Object.assign(new Error('GOOGLE_ADMISSION_PORT is required'), {
              code: 'config_invalid',
            })
          },
          {
            initialize: vi.fn(() => 'disabled' as const),
            capture: vi.fn(), // switched off: captures nothing, says nothing
            flush: vi.fn(async () => true),
            terminate: vi.fn(),
          },
        ),
      ).rejects.toThrow('sidecar startup termination returned unexpectedly')
    } finally {
      write.mockRestore()
    }

    const report = written.map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(report).toContainEqual({
      event: 'sidecar.startup_failed',
      service: 'ai-execution-admission',
      name: 'Error',
      code: 'config_invalid',
      message: 'GOOGLE_ADMISSION_PORT is required',
    })
  })

  it('owns all four process termination hooks and drains before cleanup', async () => {
    const target = processTarget()
    const order: string[] = []
    const events: SidecarLifecycleEvent[] = []

    const lifecycle = registerSidecarOperationalLifecycle({
      service: 'ai-execution-admission',
      health: {
        beginDrain: () => order.push('not-ready'),
        stop: async () => {
          order.push('health-stopped')
        },
      },
      shutdown: async () => {
        order.push('protected-and-dependencies-stopped')
      },
      shutdownTimeoutMs: 1_000,
      process: target,
      capture: vi.fn(),
      flush: vi.fn(async () => {
        order.push('monitoring-flushed')
        return true
      }),
      emit: (event) => events.push(event),
    })

    expect([...target.listeners.keys()].sort()).toEqual([
      'SIGINT',
      'SIGTERM',
      'uncaughtException',
      'unhandledRejection',
    ])
    target.listeners.get('SIGTERM')?.()
    await lifecycle.whenSettled()

    expect(order).toEqual([
      'not-ready',
      'protected-and-dependencies-stopped',
      'health-stopped',
      'monitoring-flushed',
    ])
    expect(target.exit).toHaveBeenCalledWith(0)
    expect(events.map(({ event }) => event)).toEqual([
      'sidecar_shutdown_requested',
      'sidecar_shutdown_completed',
    ])
  })

  it('captures an unhandled rejection once and exits non-zero after cleanup', async () => {
    const target = processTarget()
    const capture = vi.fn()
    const failure = new Error('never log this body')

    const lifecycle = registerSidecarOperationalLifecycle({
      service: 'ai-egress-gateway',
      health: { beginDrain: vi.fn(), stop: vi.fn(async () => undefined) },
      shutdown: vi.fn(async () => undefined),
      shutdownTimeoutMs: 1_000,
      process: target,
      capture,
      flush: vi.fn(async () => true),
      emit: vi.fn(),
    })

    target.listeners.get('unhandledRejection')?.(failure)
    target.listeners.get('uncaughtException')?.(new Error('second'))
    await lifecycle.whenSettled()

    expect(capture).toHaveBeenCalledOnce()
    expect(capture).toHaveBeenCalledWith(failure, {
      source: 'sidecar-process',
      trigger: 'unhandledRejection',
    })
    expect(target.exit).toHaveBeenCalledWith(1)
  })

  it('captures cleanup failure, still stops health, and still flushes', async () => {
    const target = processTarget()
    const capture = vi.fn()
    const flush = vi.fn(async () => true)
    const shutdownFailure = new Error('cleanup failed')
    const healthStop = vi.fn(async () => undefined)

    const lifecycle = registerSidecarOperationalLifecycle({
      service: 'ai-egress-gateway',
      health: { beginDrain: vi.fn(), stop: healthStop },
      shutdown: vi.fn(async () => {
        throw shutdownFailure
      }),
      shutdownTimeoutMs: 1_000,
      process: target,
      capture,
      flush,
      emit: vi.fn(),
    })

    target.listeners.get('SIGINT')?.()
    await lifecycle.whenSettled()

    expect(capture).toHaveBeenCalledWith(shutdownFailure, {
      source: 'sidecar-process',
      trigger: 'shutdown',
    })
    expect(healthStop).toHaveBeenCalledOnce()
    expect(flush).toHaveBeenCalledOnce()
    expect(target.exit).toHaveBeenCalledWith(1)
  })
})
