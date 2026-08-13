import { describe, expect, it, vi } from 'vitest'
import {
  StaleGoogleImportViewError,
  createGoogleImportContentLifecycle,
} from './google-import-content-lifecycle'

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

  it('rejects a late completion from the previous epoch', async () => {
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

    await expect(guarded).rejects.toBeInstanceOf(StaleGoogleImportViewError)
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
  })
})
