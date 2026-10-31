import { describe, expect, it, vi } from 'vitest'
import { createMerchantAiNoticeUpdates } from './merchant-ai-notice-updates'

const input = { organizationId: 'org', actorUserId: 'owner' }
function setup(owner = true) {
  const store = { latest: vi.fn(async () => null), markSeen: vi.fn(async () => {}) }
  return {
    store,
    service: createMerchantAiNoticeUpdates({
      store,
      isCurrentAccountAdmin: vi.fn(async () => owner),
    }),
  }
}
describe('AI update announcements are seen receipts, not consent', () => {
  it('denies non-owners before reading or writing', async () => {
    const { store, service } = setup(false)
    await expect(service.get(input)).rejects.toMatchObject({ code: 'capability_denied' })
    await expect(
      service.markSeen({ ...input, noticeVersion: 'v1', noticeDigest: 'a'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'capability_denied' })
    expect(store.latest).not.toHaveBeenCalled()
    expect(store.markSeen).not.toHaveBeenCalled()
  })
  it('reads unseen for the banner, but keeps seen updates on the overview', async () => {
    const { store, service } = setup()
    await service.get(input)
    await service.latest(input)
    expect(store.latest.mock.calls).toEqual([
      [{ ...input, unseenOnly: true }],
      [{ ...input, unseenOnly: false }],
    ])
  })
  it('passes only the current reader and notice reference to the receipt writer', async () => {
    const { store, service } = setup()
    const command = { ...input, noticeVersion: 'v2', noticeDigest: 'b'.repeat(64) }
    await service.markSeen(command)
    expect(store.markSeen).toHaveBeenCalledExactlyOnceWith(command)
  })
})
