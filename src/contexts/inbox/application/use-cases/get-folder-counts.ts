// Inbox context — get folder counts use case
// Returns counts for each folder in the email-style sidebar (ADR 0023).
// 3 folders: Open (default working view), Escalated (active flag), Closed.

import type { InboxRepository } from '../ports/inbox.repository'
import type { PropertyId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { canForContext } from '#/shared/domain/permissions'
import { getAccessiblePropertyIdsForPermission } from '#/shared/domain/property-access'
import { inboxError } from '../../domain/errors'

export type InboxFolderCounts = Readonly<{
  open: number
  escalated: number
  closed: number
}>

export type GetInboxFolderCountsInput = Readonly<Record<string, never>>

export type GetInboxFolderCountsDeps = Readonly<{
  repo: InboxRepository
  staffPublicApi: StaffPublicApi
}>

export type GetInboxFolderCounts = (
  input: GetInboxFolderCountsInput,
  ctx: AuthContext,
) => Promise<InboxFolderCounts>

export const getInboxFolderCounts =
  (deps: GetInboxFolderCountsDeps): GetInboxFolderCounts =>
  async (_input, ctx) => {
    if (!canForContext(ctx, 'inbox.read')) {
      throw inboxError('forbidden', 'No inbox read permission')
    }

    // Resolve property scoping per-permission: org-wide scope (AccountAdmin) →
    // null (all); assigned scope (PM/Staff) → their staff_assignment set.
    const accessible = await getAccessiblePropertyIdsForPermission(
      (orgId, uId, orgWide) =>
        deps.staffPublicApi.getAccessiblePropertyIds(orgId, uId, orgWide),
      ctx,
      'inbox.read',
    )

    let propertyIds: ReadonlyArray<PropertyId> | undefined
    if (accessible !== null) {
      // No assignments → no visible items. The repo treats propertyIds=[] as
      // "no filter" (org-wide), so short-circuit to zeros to avoid leaking
      // org-wide counts to a scoped user with no property assignments.
      if (accessible.length === 0) {
        return { open: 0, escalated: 0, closed: 0 }
      }
      propertyIds = accessible
    }

    const [open, escalated, closed] = await Promise.all([
      deps.repo.countByStatus(ctx.organizationId, 'open', propertyIds),
      deps.repo.countEscalatedActive(ctx.organizationId, propertyIds),
      deps.repo.countByStatus(ctx.organizationId, 'closed', propertyIds),
    ])

    return { open, escalated, closed }
  }
