import { describe, expect, it, vi } from 'vitest'
import type { GoogleImportClearReason } from './google-import-content-lifecycle'
import { createGoogleImportContentLifecycle, contentExpiryDelayMs } from './public-api'

describe('Google import provider-content lifecycle', () => {
  it('advances the epoch and clears queries before state', () => {
    const order: string[] = []
    const lifecycle = createGoogleImportContentLifecycle({
      removeQueries: vi.fn(() => {
        order.push('remove')
      }),
      clearContent: vi.fn(() => {
        order.push('clear')
      }),
    })

    const originalEpoch = lifecycle.epoch()
    lifecycle.clear('authorization_revoked')

    expect(lifecycle.epoch()).toBe(originalEpoch + 1)
    expect(order).toEqual(['remove', 'clear'])
  })

  it('returns completed content while the request still belongs to the current view', async () => {
    const lifecycle = createGoogleImportContentLifecycle({
      removeQueries: vi.fn(),
      clearContent: vi.fn(),
    })

    await expect(
      lifecycle.guard(lifecycle.epoch(), Promise.resolve({ items: ['current'] })),
    ).resolves.toEqual({
      _tag: 'current_google_import_view',
      value: { items: ['current'] },
    })
  })

  it('classifies a late completion without retaining its provider content', async () => {
    const lifecycle = createGoogleImportContentLifecycle({
      removeQueries: vi.fn(),
      clearContent: vi.fn(),
    })
    const requestEpoch = lifecycle.epoch()
    const deferred = Promise.withResolvers<{ items: string[] }>()
    const guarded = lifecycle.guard(requestEpoch, deferred.promise)

    lifecycle.clear('lease_expired')
    deferred.resolve({ items: ['provider content'] })

    await expect(guarded).resolves.toEqual({
      _tag: 'stale_google_import_view',
      clearReason: 'lease_expired',
      currentEpoch: 1,
      requestEpoch: 0,
    })
  })

  it('records the first reason for a view that is cleared repeatedly', async () => {
    const lifecycle = createGoogleImportContentLifecycle({
      removeQueries: vi.fn(),
      clearContent: vi.fn(),
    })

    lifecycle.clear('lease_expired')
    lifecycle.clear('content_expired')

    expect(lifecycle.epoch()).toBe(2)
    await expect(lifecycle.guard(0, Promise.resolve('late'))).resolves.toEqual({
      _tag: 'stale_google_import_view',
      clearReason: 'lease_expired',
      currentEpoch: 2,
      requestEpoch: 0,
    })
  })

  it('does not treat a hidden tab as a reason to clear the selection', () => {
    const reasons = [
      'authorization_revoked',
      'connection_changed',
      'content_expired',
      'lease_expired',
      'route_left',
      'tenant_changed',
    ] as const satisfies readonly GoogleImportClearReason[]
    // @ts-expect-error hiding the tab keeps provider content (ADR 0050 §3, amended 2026-09-15)
    const hidden: GoogleImportClearReason = 'page_hidden'

    expect(reasons).not.toContain(hidden)
  })

  it('uses the current callback while active', () => {
    const originalClear = vi.fn()
    const currentClear = vi.fn()
    const lifecycle = createGoogleImportContentLifecycle({
      removeQueries: vi.fn(),
      clearContent: originalClear,
    })

    lifecycle.setClearContent(currentClear)
    lifecycle.clear('connection_changed')
    expect(originalClear).not.toHaveBeenCalled()
    expect(currentClear).toHaveBeenCalledOnce()
  })

  it('never clears state for a view that was inactive when it was left, even if reactivated at once', () => {
    // React StrictMode runs an effect's cleanup and re-runs the effect
    // synchronously: deactivate, clear, activate. The clear must decide on the
    // activity it observed, not on what is true a tick later.
    const clearContent = vi.fn()
    const removeQueries = vi.fn()
    const lifecycle = createGoogleImportContentLifecycle({ removeQueries, clearContent })

    lifecycle.deactivate()
    lifecycle.clear('route_left')
    lifecycle.activate()

    expect(removeQueries).toHaveBeenCalledOnce()
    expect(clearContent).not.toHaveBeenCalled()
    expect(lifecycle.epoch()).toBe(1)
  })

  it('keeps the view when it is re-mounted before a scheduled leave runs', async () => {
    // StrictMode: effect cleanup (leave) then the effect again (activate), with
    // the same lifecycle and the same view epoch in the owning component.
    let pending: (() => void) | null = null
    const removeQueries = vi.fn()
    const clearContent = vi.fn()
    const lifecycle = createGoogleImportContentLifecycle({
      removeQueries,
      clearContent,
      schedule: (run) => {
        pending = run
        return () => {
          pending = null
        }
      },
    })
    const requestEpoch = lifecycle.epoch()

    lifecycle.leave()
    lifecycle.activate()

    expect(pending).toBeNull()
    expect(removeQueries).not.toHaveBeenCalled()
    expect(lifecycle.epoch()).toBe(requestEpoch)
    await expect(
      lifecycle.guard(requestEpoch, Promise.resolve('accounts')),
    ).resolves.toEqual({ _tag: 'current_google_import_view', value: 'accounts' })
  })

  it('clears provider content one task after a view really leaves, without resetting its state', async () => {
    const removeQueries = vi.fn()
    const clearContent = vi.fn()
    const lifecycle = createGoogleImportContentLifecycle({ removeQueries, clearContent })

    lifecycle.leave()
    expect(removeQueries).not.toHaveBeenCalled()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(removeQueries).toHaveBeenCalledOnce()
    expect(clearContent).not.toHaveBeenCalled()
    expect(lifecycle.epoch()).toBe(1)
    await expect(lifecycle.guard(0, Promise.resolve('late'))).resolves.toMatchObject({
      _tag: 'stale_google_import_view',
      clearReason: 'route_left',
    })
  })

  it('fails closed for invalid and expired deadlines and bounds timer delays', () => {
    const now = Date.parse('2026-08-12T10:00:00.000Z')

    expect(contentExpiryDelayMs('invalid', now)).toBe(0)
    expect(contentExpiryDelayMs('2026-08-12T09:59:59.999Z', now)).toBe(0)
    expect(contentExpiryDelayMs('2026-08-12T10:15:00.000Z', now)).toBe(900_000)
    expect(contentExpiryDelayMs('2099-01-01T00:00:00.000Z', now)).toBe(2_147_483_647)
  })
})
