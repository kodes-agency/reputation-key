import { describe, expect, it, vi } from 'vitest'
import { createGoogleImportContentLifecycle, contentExpiryDelayMs } from './public-api'

describe('Google import provider-content lifecycle', () => {
  it('advances the epoch and clears in cancel, remove, state order', async () => {
    const order: string[] = []
    const lifecycle = createGoogleImportContentLifecycle({
      cancelQueries: vi.fn(async () => {
        order.push('cancel')
      }),
      removeQueries: vi.fn(() => {
        order.push('remove')
      }),
      clearContent: vi.fn(() => {
        order.push('clear')
      }),
    })

    const originalEpoch = lifecycle.epoch()
    await lifecycle.clear('authorization_revoked')

    expect(lifecycle.epoch()).toBe(originalEpoch + 1)
    expect(order).toEqual(['cancel', 'remove', 'clear'])
  })

  it('returns completed content while the request still belongs to the current view', async () => {
    const lifecycle = createGoogleImportContentLifecycle({
      cancelQueries: vi.fn(async () => {}),
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
      cancelQueries: vi.fn(async () => {}),
      removeQueries: vi.fn(),
      clearContent: vi.fn(),
    })
    const requestEpoch = lifecycle.epoch()
    const deferred = Promise.withResolvers<{ items: string[] }>()
    const guarded = lifecycle.guard(requestEpoch, deferred.promise)

    await lifecycle.clear('page_hidden')
    deferred.resolve({ items: ['provider content'] })

    await expect(guarded).resolves.toEqual({
      _tag: 'stale_google_import_view',
      clearReason: 'page_hidden',
      currentEpoch: 1,
      requestEpoch: 0,
    })
  })

  it('coalesces concurrent clear triggers into ordered clearing operations', async () => {
    const order: string[] = []
    const lifecycle = createGoogleImportContentLifecycle({
      cancelQueries: vi.fn(async () => {
        order.push('cancel')
      }),
      removeQueries: vi.fn(() => order.push('remove')),
      clearContent: vi.fn(() => order.push('clear')),
    })

    await Promise.all([
      lifecycle.clear('page_hidden'),
      lifecycle.clear('content_expired'),
      lifecycle.clear('lease_expired'),
    ])

    expect(order).toEqual(['cancel', 'remove', 'clear'])
    expect(lifecycle.epoch()).toBe(1)
    await expect(lifecycle.guard(0, Promise.resolve('late'))).resolves.toEqual({
      _tag: 'stale_google_import_view',
      clearReason: 'page_hidden',
      currentEpoch: 1,
      requestEpoch: 0,
    })
  })

  it('uses current callbacks while active and suppresses content updates after deactivation', async () => {
    const originalClear = vi.fn()
    const currentClear = vi.fn()
    const lifecycle = createGoogleImportContentLifecycle({
      cancelQueries: vi.fn(async () => {}),
      removeQueries: vi.fn(),
      clearContent: originalClear,
    })

    lifecycle.setClearContent(currentClear)
    await lifecycle.clear('connection_changed')
    expect(originalClear).not.toHaveBeenCalled()
    expect(currentClear).toHaveBeenCalledOnce()

    lifecycle.deactivate()
    await lifecycle.clear('route_left')
    expect(currentClear).toHaveBeenCalledOnce()
  })

  it('fails closed for invalid and expired deadlines and bounds timer delays', () => {
    const now = Date.parse('2026-08-12T10:00:00.000Z')

    expect(contentExpiryDelayMs('invalid', now)).toBe(0)
    expect(contentExpiryDelayMs('2026-08-12T09:59:59.999Z', now)).toBe(0)
    expect(contentExpiryDelayMs('2026-08-12T10:15:00.000Z', now)).toBe(900_000)
    expect(contentExpiryDelayMs('2099-01-01T00:00:00.000Z', now)).toBe(2_147_483_647)
  })
})
