// Inbox context — get inbox item detail use case
// Returns full detail view (item + source data) for a single inbox item.

import type { InboxRepository } from '../ports/inbox.repository'
import type { InboxItemId, OrganizationId } from '#/shared/domain/ids'
import type { InboxItemDetail } from '../../domain/types'
import { inboxError } from '../../domain/errors'

export type GetInboxItemDetailInput = Readonly<{
  inboxItemId: InboxItemId
  organizationId: OrganizationId
}>

// fallow-ignore-next-line unused-type
export type GetInboxItemDetailDeps = Readonly<{
  repo: InboxRepository
}>

export const getInboxItemDetail =
  (deps: GetInboxItemDetailDeps) =>
  async (input: GetInboxItemDetailInput): Promise<InboxItemDetail> => {
    const detail = await deps.repo.findDetailById(input.inboxItemId, input.organizationId)
    if (!detail) {
      throw inboxError('not_found', 'Inbox item not found', {
        inboxItemId: input.inboxItemId,
      })
    }
    return detail
  }

// fallow-ignore-next-line unused-type
export type GetInboxItemDetailUseCase = ReturnType<typeof getInboxItemDetail>
