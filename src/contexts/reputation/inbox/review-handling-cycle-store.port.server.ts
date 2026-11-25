import type { Tx } from '#/shared/outbox/commit'
import type { InboxItemId, OrganizationId } from '#/shared/domain/ids'
import type { HandlingCycleHead } from '../domain/inbox-types'

export type HandlingCycleExpectation = Readonly<{
  cycleNumber: number
  sourceRevision: number
  stateRevision: number
}>

export type ReviewHandlingCycleStore = Readonly<{
  findHead(
    inboxItemId: InboxItemId,
    organizationId: OrganizationId,
    tx?: Tx,
  ): Promise<HandlingCycleHead | null>
}>
