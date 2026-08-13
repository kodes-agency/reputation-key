import { describe, expect, it, vi } from 'vitest'
import {
  createProviderAuthorizationInvalidationFanout,
  type ProviderAuthorizationInvalidation,
} from './authorization-invalidation'
import { createInMemoryProviderEphemeralStore } from './in-memory-store'

const NOW = 1_800_000_000_000
const EVENT = {
  eventId: '00000000-0000-4000-8000-000000000010',
  kind: 'property_binding_changed' as const,
  organizationId: 'org-1',
  propertyId: '00000000-0000-4000-8000-000000000001',
  connectionId: '00000000-0000-4000-8000-000000000002',
  sourceEpoch: 3,
}

function owner(value: string) {
  return () => value.repeat(43)
}

describe('provider authorization invalidation fanout', () => {
  it('fans out an identifier-only event once across duplicate delivery', async () => {
    const first = vi.fn(async () => undefined)
    const second = vi.fn(async () => undefined)
    const fanout = createProviderAuthorizationInvalidationFanout({
      store: createInMemoryProviderEphemeralStore(() => NOW),
      randomOwner: owner('a'),
      handlers: [
        { id: 'import', invalidate: first },
        { id: 'performance', invalidate: second },
      ],
    })
    await expect(fanout.dispatch(EVENT, NOW)).resolves.toEqual({
      ok: true,
      status: 'delivered',
    })
    await expect(fanout.dispatch(EVENT, NOW + 1)).resolves.toEqual({
      ok: true,
      status: 'duplicate',
    })
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).toHaveBeenCalledWith(EVENT)
  })

  it('resumes after a handler failure without repeating completed handlers', async () => {
    const first = vi.fn(async () => undefined)
    const second = vi
      .fn<(event: ProviderAuthorizationInvalidation) => Promise<void>>()
      .mockRejectedValueOnce(new Error('redis shard unavailable'))
      .mockResolvedValue(undefined)
    const fanout = createProviderAuthorizationInvalidationFanout({
      store: createInMemoryProviderEphemeralStore(() => NOW),
      randomOwner: owner('b'),
      handlers: [
        { id: 'import', invalidate: first },
        { id: 'performance', invalidate: second },
      ],
    })
    await expect(fanout.dispatch(EVENT, NOW)).resolves.toEqual({
      ok: false,
      code: 'runtime_unavailable',
    })
    await expect(fanout.dispatch(EVENT, NOW + 1)).resolves.toEqual({
      ok: true,
      status: 'delivered',
    })
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)
  })

  it('allows only one cross-replica dispatcher to hold the processing lease', async () => {
    let release: (() => void) | undefined
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const handler = vi.fn(async () => blocked)
    const store = createInMemoryProviderEphemeralStore(() => NOW)
    const first = createProviderAuthorizationInvalidationFanout({
      store,
      randomOwner: owner('c'),
      handlers: [{ id: 'import', invalidate: handler }],
    })
    const second = createProviderAuthorizationInvalidationFanout({
      store,
      randomOwner: owner('d'),
      handlers: [{ id: 'import', invalidate: handler }],
    })
    const firstDispatch = first.dispatch(EVENT, NOW)
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1))
    await expect(second.dispatch(EVENT, NOW + 1)).resolves.toEqual({
      ok: false,
      code: 'in_progress',
    })
    release?.()
    await expect(firstDispatch).resolves.toEqual({
      ok: true,
      status: 'delivered',
    })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('rejects reuse of an event id with different routing facts', async () => {
    const fanout = createProviderAuthorizationInvalidationFanout({
      store: createInMemoryProviderEphemeralStore(() => NOW),
      randomOwner: owner('e'),
      handlers: [],
    })
    await expect(fanout.dispatch(EVENT, NOW)).resolves.toMatchObject({ ok: true })
    await expect(
      fanout.dispatch({ ...EVENT, organizationId: 'org-2' }, NOW + 1),
    ).resolves.toEqual({ ok: false, code: 'payload_mismatch' })
  })
})
