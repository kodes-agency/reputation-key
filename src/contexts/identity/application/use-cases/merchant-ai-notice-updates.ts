import type { MerchantAiNoticeUpdate } from '#/shared/merchant-ai-notice-announcements'
import { MerchantAiAuthorizationError } from './merchant-ai-authorization'

export type MerchantAiUpdateReaderInput = Readonly<{
  organizationId: string
  actorUserId: string
}>
export type MerchantAiUpdateReference = Readonly<{
  noticeVersion: string
  noticeDigest: string
}>
export type MerchantAiNoticeUpdateStore = Readonly<{
  latest(
    input: MerchantAiUpdateReaderInput & { unseenOnly: boolean },
  ): Promise<MerchantAiNoticeUpdate | null>
  markSeen(input: MerchantAiUpdateReaderInput & MerchantAiUpdateReference): Promise<void>
}>

export function createMerchantAiNoticeUpdates(
  deps: Readonly<{
    store: MerchantAiNoticeUpdateStore
    isCurrentAccountAdmin: (input: MerchantAiUpdateReaderInput) => Promise<boolean>
  }>,
) {
  async function requireOwner(input: MerchantAiUpdateReaderInput) {
    if (!(await deps.isCurrentAccountAdmin(input))) {
      throw new MerchantAiAuthorizationError(
        'capability_denied',
        'Only an account admin can view AI updates',
      )
    }
  }
  return Object.freeze({
    async get(input: MerchantAiUpdateReaderInput) {
      await requireOwner(input)
      return deps.store.latest({ ...input, unseenOnly: true })
    },
    async latest(input: MerchantAiUpdateReaderInput) {
      await requireOwner(input)
      return deps.store.latest({ ...input, unseenOnly: false })
    },
    async markSeen(input: MerchantAiUpdateReaderInput & MerchantAiUpdateReference) {
      await requireOwner(input)
      await deps.store.markSeen(input)
    },
  })
}
export type MerchantAiNoticeUpdates = ReturnType<typeof createMerchantAiNoticeUpdates>
