import { describe, expect, it, vi } from 'vitest'
import { createSidecarProcessLifecycle } from './process-lifecycle'

describe('sidecar process lifecycle (REG-04)', () => {
  it('owns one signal, emits a structured drain sequence, and exits zero', async () => {
    const events: unknown[] = []
    const shutdown = vi.fn(async () => {})
    const exit = vi.fn()
    const lifecycle = createSidecarProcessLifecycle({
      service: 'google-egress-gateway',
      shutdown,
      exit,
      emit: (event) => void events.push(event),
      shutdownTimeoutMs: 100,
    })

    lifecycle.onSignal('SIGTERM')
    lifecycle.onSignal('SIGINT')
    await lifecycle.whenSettled()

    expect(shutdown).toHaveBeenCalledOnce()
    expect(shutdown).toHaveBeenCalledWith('SIGTERM')
    expect(exit).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(0)
    expect(events).toEqual([
      {
        event: 'sidecar_shutdown_requested',
        service: 'google-egress-gateway',
        trigger: 'SIGTERM',
        exitCode: 0,
      },
      {
        event: 'sidecar_shutdown_completed',
        service: 'google-egress-gateway',
        trigger: 'SIGTERM',
        exitCode: 0,
      },
    ])
  })

  it.each([
    ['unhandledRejection' as const, 'onUnhandledRejection' as const],
    ['uncaughtException' as const, 'onUncaughtException' as const],
  ])('sanitizes %s and drains before non-zero exit', async (trigger, method) => {
    const marker = 'private-provider-token'
    const events: unknown[] = []
    const exit = vi.fn()
    const lifecycle = createSidecarProcessLifecycle({
      service: 'ai-execution-admission',
      shutdown: vi.fn(async () => {}),
      exit,
      emit: (event) => void events.push(event),
      shutdownTimeoutMs: 100,
    })

    lifecycle[method](Object.assign(new Error(marker), { code: 'ECONNRESET' }))
    await lifecycle.whenSettled()

    expect(exit).toHaveBeenCalledWith(1)
    expect(events).toContainEqual({
      event: 'sidecar_fatal_process_error',
      service: 'ai-execution-admission',
      trigger,
      errorClass: 'Error',
      errorCode: 'ECONNRESET',
    })
    expect(JSON.stringify(events)).not.toContain(marker)
  })

  it('fails non-zero and emits no raw error when shutdown rejects', async () => {
    const marker = 'database-password-marker'
    const events: unknown[] = []
    const exit = vi.fn()
    const lifecycle = createSidecarProcessLifecycle({
      service: 'google-execution-admission',
      shutdown: vi.fn(async () => {
        throw new Error(marker)
      }),
      exit,
      emit: (event) => void events.push(event),
      shutdownTimeoutMs: 100,
    })

    lifecycle.onSignal('SIGTERM')
    await lifecycle.whenSettled()

    expect(exit).toHaveBeenCalledWith(1)
    expect(events).toContainEqual({
      event: 'sidecar_shutdown_failed',
      service: 'google-execution-admission',
      trigger: 'SIGTERM',
      errorClass: 'Error',
    })
    expect(JSON.stringify(events)).not.toContain(marker)
  })

  it('bounds a hung drain and records the timeout before non-zero exit', async () => {
    vi.useFakeTimers()
    try {
      const events: unknown[] = []
      const exit = vi.fn()
      const lifecycle = createSidecarProcessLifecycle({
        service: 'ai-egress-gateway',
        shutdown: vi.fn(() => new Promise<void>(() => {})),
        exit,
        emit: (event) => void events.push(event),
        shutdownTimeoutMs: 25,
      })

      lifecycle.onSignal('SIGTERM')
      await vi.advanceTimersByTimeAsync(25)
      await lifecycle.whenSettled()

      expect(exit).toHaveBeenCalledWith(1)
      expect(events).toContainEqual({
        event: 'sidecar_shutdown_timed_out',
        service: 'ai-egress-gateway',
        trigger: 'SIGTERM',
        timeoutMs: 25,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not expose primitive rejection values', async () => {
    const marker = 'raw-secret-rejection'
    const events: unknown[] = []
    const lifecycle = createSidecarProcessLifecycle({
      service: 'google-egress-gateway',
      shutdown: vi.fn(async () => {}),
      exit: vi.fn(),
      emit: (event) => void events.push(event),
      shutdownTimeoutMs: 100,
    })

    lifecycle.onUnhandledRejection(marker)
    await lifecycle.whenSettled()

    expect(events).toContainEqual({
      event: 'sidecar_fatal_process_error',
      service: 'google-egress-gateway',
      trigger: 'unhandledRejection',
      errorClass: 'NonErrorRejection',
    })
    expect(JSON.stringify(events)).not.toContain(marker)
  })

  it('does not trust arbitrary error names or codes as content-free metadata', async () => {
    const events: unknown[] = []
    const lifecycle = createSidecarProcessLifecycle({
      service: 'google-execution-admission',
      shutdown: vi.fn(async () => {}),
      exit: vi.fn(),
      emit: (event) => void events.push(event),
      shutdownTimeoutMs: 100,
    })
    const error = Object.assign(new Error('not retained'), {
      name: 'PrivateProviderMarker',
      code: 'PrivateCredentialMarker',
    })

    lifecycle.onUncaughtException(error)
    await lifecycle.whenSettled()

    expect(events).toContainEqual({
      event: 'sidecar_fatal_process_error',
      service: 'google-execution-admission',
      trigger: 'uncaughtException',
      errorClass: 'Error',
    })
    expect(JSON.stringify(events)).not.toContain('PrivateProviderMarker')
    expect(JSON.stringify(events)).not.toContain('PrivateCredentialMarker')
  })
})
