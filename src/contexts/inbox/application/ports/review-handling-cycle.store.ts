import type { InboxItemId, OrganizationId, UserId } from '#/shared/domain/ids'
import type { ReviewHandlingCycle, ReviewHandlingCycleHead } from '../../domain/types'

export type ReviewHandlingCycleExpectation = Readonly<{
  cycleNumber: number
  materialReviewRevision: number
  stateRevision: number
}>

export type StartNextReviewHandlingCycleCommand = Readonly<{
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  expected: ReviewHandlingCycleExpectation
  materialReviewRevision: number
  openedReason: 'material_revision_changed' | 'manual_reopen'
  openedBy: UserId | null
  openedAt: Date
}>

export type ReviewHandlingCycleResult = Readonly<{
  cycle: ReviewHandlingCycle
  head: ReviewHandlingCycleHead
}>

export type ReviewHandlingCycleStore = Readonly<{
  findHead(
    inboxItemId: InboxItemId,
    organizationId: OrganizationId,
  ): Promise<ReviewHandlingCycleHead | null>
  listCycles(
    inboxItemId: InboxItemId,
    organizationId: OrganizationId,
  ): Promise<ReadonlyArray<ReviewHandlingCycle>>
  startNext(
    command: StartNextReviewHandlingCycleCommand,
  ): Promise<ReviewHandlingCycleResult>
}>
