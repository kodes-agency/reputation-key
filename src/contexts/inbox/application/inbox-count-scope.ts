// Inbox context — the visibility envelope every Inbox count reads under.
//
// The queue rail counts queues within one scope; the property section counts one
// queue per property. Both must see exactly the rows the list would show, so they
// resolve visibility here, once, and in the same order the list does.

import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { PropertyId } from '#/shared/domain/ids'
import { inboxError } from '../domain/errors'
import { propertyIdsForInboxSource, resolveInboxSourceScopes } from './inbox-access'
import type { InboxReplyStages } from './inbox-queues'
import type { InboxSourceScope } from './ports/inbox.repository'
import type { ReplyLookupPort } from './ports/reply-lookup.port'
import { resolveVisiblePropertyIds } from './visible-properties'

export type InboxCountScope = Readonly<{
  /** Undefined when the caller sees every property of the organization. */
  propertyIds: ReadonlyArray<PropertyId> | undefined
  sourceScopes: ReadonlyArray<InboxSourceScope>
}>

export const NO_REPLY_STAGES: InboxReplyStages = { awaiting: [], waiting: [] }

/**
 * Resolve what a count may read, narrowed to `propertyId` when one is given.
 * Null means the caller can see no Inbox rows at all; an inaccessible
 * `propertyId` is refused rather than silently widened or emptied.
 */
export async function resolveInboxCountScope(
  staffPublicApi: StaffPublicApi,
  ctx: AuthContext,
  propertyId?: string,
): Promise<InboxCountScope | null> {
  const visible = await resolveVisiblePropertyIds(staffPublicApi, ctx, 'inbox.read')
  if (visible === 'none') return null

  const sourceScopes = await resolveInboxSourceScopes(staffPublicApi, ctx, 'read')
  if (sourceScopes.length === 0) return null

  if (visible !== 'all' && propertyId && !visible.includes(propertyId as PropertyId)) {
    throw inboxError('forbidden', 'No access to this property', { propertyId })
  }

  const propertyIds = propertyId
    ? [propertyId as PropertyId]
    : visible === 'all'
      ? undefined
      : visible
  return { propertyIds, sourceScopes }
}

/** The review ids in each reply stage, read once for the whole count scope. */
export function findScopeReplyStages(
  replyLookup: ReplyLookupPort,
  ctx: AuthContext,
  scope: InboxCountScope,
): Promise<InboxReplyStages> {
  return replyLookup.findReviewIdsByReplyStage(
    ctx.organizationId,
    propertyIdsForInboxSource(scope.sourceScopes, 'review', scope.propertyIds),
  )
}
