import type { Tx } from '#/shared/outbox/commit'
import type { InboxItemId, OrganizationId } from '#/shared/domain/ids'
import type { HandlingCycleHead, ReviewHandlingCycleHead } from '../../domain/types'

export type ReviewHandlingCycleExpectation = Readonly<{
  cycleNumber: number
  materialReviewRevision: number
  stateRevision: number
}>

export type HandlingCycleExpectation = Readonly<{
  cycleNumber: number
  sourceRevision: number
  stateRevision: number
}>

export type ReviewHandlingCycleStore = Readonly<{
  findSourceHead?(
    inboxItemId: InboxItemId,
    organizationId: OrganizationId,
  ): Promise<HandlingCycleHead | null>
  findHead(
    inboxItemId: InboxItemId,
    organizationId: OrganizationId,
    tx?: Tx,
  ): Promise<ReviewHandlingCycleHead | null>
}>
