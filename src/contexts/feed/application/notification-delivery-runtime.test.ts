// ARC-03-T12 — the delivery capability's assembly contract.
//
// The root reads this capability by shape: `notification.delivery.repos.*` for
// the three worker repositories and `notification.delivery.<handler>` for the
// four handlers (src/composition.ts:855-866). Both halves of that shape are
// assembled here, so both are asserted here — a handler that stopped being
// lifted to the top level, or a `repos` that stopped being nested, would reach
// the root as `undefined` and only surface as a null dereference inside a job.
//
// The undefined-handler case matters most: without a job queue the sweep
// handler is deliberately absent, and the root forwards that absence. If the
// key were dropped instead of carried through as undefined, a later `in` check
// on the root's runtime would silently change meaning.

import { describe, expect, it, vi } from 'vitest'
import { createNotificationDeliveryRuntime } from './notification-delivery-runtime'

const repos = () => ({
  notificationRepo: { kind: 'notification' as const },
  emailRepo: { kind: 'email' as const },
  preferenceRepo: { kind: 'preference' as const },
})

const handlers = () => ({
  handleResendEvent: vi.fn(),
  authorizeAudience: vi.fn(),
  deliverySettlement: vi.fn(),
  reconcileMissingNotificationsHandler: vi.fn(),
})

describe('createNotificationDeliveryRuntime — assembled shape', () => {
  it('nests persistence under repos and lifts every handler to the top level', () => {
    const runtime = createNotificationDeliveryRuntime({
      repos: repos(),
      handlers: handlers(),
    })

    expect(Object.keys(runtime).sort()).toEqual([
      'authorizeAudience',
      'deliverySettlement',
      'handleResendEvent',
      'reconcileMissingNotificationsHandler',
      'repos',
    ])
    expect(Object.keys(runtime.repos).sort()).toEqual([
      'emailRepo',
      'notificationRepo',
      'preferenceRepo',
    ])
  })

  it('forwards the same repository instances the build wired', () => {
    const wired = repos()

    const runtime = createNotificationDeliveryRuntime({ repos: wired, handlers: {} })

    expect(runtime.repos.notificationRepo).toBe(wired.notificationRepo)
    expect(runtime.repos.emailRepo).toBe(wired.emailRepo)
    expect(runtime.repos.preferenceRepo).toBe(wired.preferenceRepo)
  })

  it('forwards handlers by identity, so calling through the capability calls the handler', async () => {
    const wired = handlers()
    wired.handleResendEvent.mockResolvedValue('handled')

    const runtime = createNotificationDeliveryRuntime({ repos: repos(), handlers: wired })

    expect(runtime.handleResendEvent).toBe(wired.handleResendEvent)
    await expect(runtime.handleResendEvent('event')).resolves.toBe('handled')
    expect(wired.handleResendEvent).toHaveBeenCalledWith('event')
  })

  it('carries an absent handler through as a present key with an undefined value', () => {
    // Exactly what the build produces without a job queue: the sweep handler is
    // undefined, not missing.
    const runtime = createNotificationDeliveryRuntime({
      repos: repos(),
      handlers: {
        handleResendEvent: vi.fn(),
        reconcileMissingNotificationsHandler: undefined,
      },
    })

    expect('reconcileMissingNotificationsHandler' in runtime).toBe(true)
    expect(runtime.reconcileMissingNotificationsHandler).toBeUndefined()
  })
})

describe('createNotificationDeliveryRuntime — what the root cannot do to it', () => {
  it('freezes the capability, so the root cannot swap a handler after the build', () => {
    const runtime = createNotificationDeliveryRuntime({
      repos: repos(),
      handlers: handlers(),
    })
    const wired = runtime.handleResendEvent

    expect(Object.isFrozen(runtime)).toBe(true)
    expect(() => {
      ;(runtime as { handleResendEvent: unknown }).handleResendEvent = vi.fn()
    }).toThrow(TypeError)
    expect(runtime.handleResendEvent).toBe(wired)
  })

  it('freezes the repos binding, so the root cannot swap a repository', () => {
    const runtime = createNotificationDeliveryRuntime({
      repos: repos(),
      handlers: {},
    })
    const wired = runtime.repos.emailRepo

    expect(Object.isFrozen(runtime.repos)).toBe(true)
    expect(() => {
      ;(runtime.repos as { emailRepo: unknown }).emailRepo = { kind: 'swapped' }
    }).toThrow(TypeError)
    expect(runtime.repos.emailRepo).toBe(wired)
  })

  it('copies the repos bindings, so a later write to the build-side object is not observed', () => {
    // `{ ...input.repos }` snapshots which instance each name points at. The
    // instances themselves are shared, not cloned — this asserts the binding
    // snapshot only.
    const wired = repos()
    const runtime = createNotificationDeliveryRuntime({ repos: wired, handlers: {} })
    const original = wired.emailRepo

    wired.emailRepo = { kind: 'email' as const }

    expect(runtime.repos.emailRepo).toBe(original)
  })
})
