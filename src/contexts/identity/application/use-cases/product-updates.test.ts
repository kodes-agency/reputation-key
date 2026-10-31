import { describe, expect, it, vi } from 'vitest'
import { organizationId, userId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import { PRODUCT_UPDATES } from '#/shared/whats-new/entries'
import { createProductUpdates } from './product-updates'

const actor: AuthContext = {
  userId: userId('reader'),
  organizationId: organizationId('organization'),
  role: 'PropertyManager',
}
const state = {
  membershipStartedAt: new Date('2026-01-01'),
  autoShow: true,
  lastAutoOpenedAt: null,
  seenIds: [],
}
function fixture() {
  const store = {
    read: vi.fn(async () => state),
    claim: vi.fn(async () => true),
    markSeen: vi.fn(async () => undefined),
    setAutoShow: vi.fn(async () => undefined),
  }
  const service = createProductUpdates({
    store,
    clock: () => new Date('2026-10-31T12:00:00Z'),
    hasCapability: () => false,
  })
  return { store, service }
}
describe('Identity product update commands', () => {
  it('reads and claims only for the authenticated person', async () => {
    const { store, service } = fixture()
    expect((await service.get({ actor })).entries).toHaveLength(5)
    expect(await service.claim({ actor })).toBe(true)
    expect(store.claim).toHaveBeenCalledWith(actor)
  })
  it('does not attempt a claim after an opt-out or without an unseen highlight', async () => {
    const { store, service } = fixture()
    store.read.mockResolvedValueOnce({ ...state, autoShow: false })
    expect(await service.claim({ actor })).toBe(false)
    expect(store.claim).not.toHaveBeenCalled()
  })
  it('discards unknown, duplicate and ineligible receipt ids', async () => {
    const { store, service } = fixture()
    const eligible = PRODUCT_UPDATES[1]!.id
    await service.markSeen({ actor }, [
      eligible,
      eligible,
      'unknown',
      PRODUCT_UPDATES[0]!.id,
    ])
    expect(store.markSeen).toHaveBeenCalledWith(actor, [eligible])
  })
  it('writes just this person’s automatic-show preference', async () => {
    const { store, service } = fixture()
    await service.setAutoShow(actor, false)
    expect(store.setAutoShow).toHaveBeenCalledWith(actor, false)
  })
})
