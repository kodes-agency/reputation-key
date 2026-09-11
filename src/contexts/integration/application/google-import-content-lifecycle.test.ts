import { describe, expect, it, vi } from 'vitest'
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

    lifecycle.clear('page_hidden')
    deferred.resolve({ items: ['provider content'] })

    await expect(guarded).resolves.toEqual({
      _tag: 'stale_google_import_view',
      clearReason: 'page_hidden',
      currentEpoch: 1,
      requestEpoch: 0,
    })
  })

  it('records the first reason for a view that is cleared repeatedly', async () => {
    const lifecycle = createGoogleImportContentLifecycle({
      removeQueries: vi.fn(),
      clearContent: vi.fn(),
    })

    lifecycle.clear('page_hidden')
    lifecycle.clear('content_expired')

    expect(lifecycle.epoch()).toBe(2)
    await expect(lifecycle.guard(0, Promise.resolve('late'))).resolves.toEqual({
      _tag: 'stale_google_import_view',
      clearReason: 'page_hidden',
      currentEpoch: 2,
      requestEpoch: 0,
    })
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

  it('fails closed for invalid and expired deadlines and bounds timer delays', () => {
    const now = Date.parse('2026-08-12T10:00:00.000Z')

    expect(contentExpiryDelayMs('invalid', now)).toBe(0)
    expect(contentExpiryDelayMs('2026-08-12T09:59:59.999Z', now)).toBe(0)
    expect(contentExpiryDelayMs('2026-08-12T10:15:00.000Z', now)).toBe(900_000)
    expect(contentExpiryDelayMs('2099-01-01T00:00:00.000Z', now)).toBe(2_147_483_647)
  })
})
