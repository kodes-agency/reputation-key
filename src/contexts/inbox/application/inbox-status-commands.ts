import type { InboxItemId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { InboxItem, InboxStatus, ManualReopenReason } from '../domain/types'

export type UpdateInboxStatusInput = Readonly<{
  inboxItemId: InboxItemId
  newStatus: InboxStatus
  expectedCommandRevision: number
  reopenReason?: ManualReopenReason
  reopenExplanation?: string | null
}>

export type UpdateInboxStatus = (
  input: UpdateInboxStatusInput,
  ctx: AuthContext,
) => Promise<InboxItem>

export type BulkReopenItemInput = Readonly<{
  inboxItemId: InboxItemId
  expectedCommandRevision: number
}>

export type BulkReopenItemOutcome =
  'reopened' | 'already_open' | 'revision_conflict' | 'unavailable'

export type BulkReopenItemResult = Readonly<{
  inboxItemId: InboxItemId
  outcome: BulkReopenItemOutcome
}>

export type BulkUpdateInboxStatusInput = Readonly<{
  items: ReadonlyArray<BulkReopenItemInput>
  newStatus: 'open'
  reopenReason: ManualReopenReason
  reopenExplanation?: string | null
}>

export type BulkUpdateInboxStatusResult = Readonly<{
  updated: number
  results: ReadonlyArray<BulkReopenItemResult>
}>

export type BulkUpdateInboxStatus = (
  input: BulkUpdateInboxStatusInput,
  ctx: AuthContext,
) => Promise<BulkUpdateInboxStatusResult>
