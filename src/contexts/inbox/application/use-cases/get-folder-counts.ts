// Inbox context — get folder counts use case
// Returns counts for each folder in the email-style sidebar.
// Uses repository's countByStatus for each relevant status.

import type { InboxRepository } from '../ports/inbox.repository'
import type { PropertyId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { canForContext } from '#/shared/domain/permissions'
import { getAccessiblePropertyIdsForPermission } from '#/shared/domain/property-access'
import { inboxError } from '../../domain/errors'

export type InboxFolderCounts = Readonly<{
  inbox: number
  unaddressed: number
  escalated: number
  addressed: number
  archived: number
}>

export type GetInboxFolderCountsInput = Readonly<Record<string, never>>

// fallow-ignore-next-line unused-type
export type GetInboxFolderCountsDeps = Readonly<{
  repo: InboxRepository
  staffPublicApi: StaffPublicApi
}>

export const getInboxFolderCounts =
  (deps: GetInboxFolderCountsDeps) =>
  async (
    _input: GetInboxFolderCountsInput,
    ctx: AuthContext,
  ): Promise<InboxFolderCounts> => {
    if (!canForContext(ctx, 'inbox.read')) {
      throw inboxError('forbidden', 'No inbox read permission')
    }

    // Resolve property scoping per-permission: org-wide scope (AccountAdmin) →
    // null (all); assigned scope (PM/Staff) → their staff_assignment set.
    // (PM holds inbox.manage but inbox.read scope is assigned — CONTEXT.md L72.)
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
        return { inbox: 0, unaddressed: 0, escalated: 0, addressed: 0, archived: 0 }
      }
      propertyIds = accessible
    }

    const [newCount, readCount, escalated, addressed, archived] = await Promise.all([
      deps.repo.countByStatus(ctx.organizationId, 'new', propertyIds),
      deps.repo.countByStatus(ctx.organizationId, 'read', propertyIds),
      deps.repo.countByStatus(ctx.organizationId, 'escalated', propertyIds),
      deps.repo.countByStatus(ctx.organizationId, 'addressed', propertyIds),
      deps.repo.countByStatus(ctx.organizationId, 'archived', propertyIds),
    ])

    const unaddressed = newCount + readCount

    return {
      inbox: newCount + readCount + escalated + addressed + archived,
      unaddressed,
      escalated,
      addressed,
      archived,
    }
  }

// fallow-ignore-next-line unused-type
export type GetInboxFolderCounts = ReturnType<typeof getInboxFolderCounts>
