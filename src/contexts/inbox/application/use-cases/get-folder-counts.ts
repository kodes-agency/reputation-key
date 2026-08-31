// Inbox context — get folder counts use case
// Returns counts for each folder in the email-style sidebar (ADR 0023).
// 3 folders: Open (default working view), Escalated (active flag), Closed.

import type { InboxRepository } from '../ports/inbox.repository'
import type { PropertyId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { inboxError } from '../../domain/errors'
import { resolveVisiblePropertyIds } from '../visible-properties'
import { resolveInboxSourceScopes } from '../inbox-access'

export type InboxFolderCounts = Readonly<{
  open: number
  escalated: number
  closed: number
}>

export type GetInboxFolderCountsInput = Readonly<{
  /** When set, counts are scoped to this property (permission-checked). */
  propertyId?: string
}>

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
  async (input, ctx) => {
    // Resolve property scoping per-permission: org-wide scope (AccountAdmin) →
    // 'all'; assigned scope (PM/Staff) → their staff_assignment set ('none'
    // short-circuits to zeros — a scoped user with no assignments must not
    // see org-wide counts).
    const visible = await resolveVisiblePropertyIds(
      deps.staffPublicApi,
      ctx,
      'inbox.read',
    )
    if (visible === 'none') {
      return { open: 0, escalated: 0, closed: 0 }
    }
    const sourceScopes = await resolveInboxSourceScopes(deps.staffPublicApi, ctx, 'read')
    if (sourceScopes.length === 0) {
      return { open: 0, escalated: 0, closed: 0 }
    }

    let propertyIds: ReadonlyArray<PropertyId> | undefined
    if (visible !== 'all') {
      if (input.propertyId && !visible.includes(input.propertyId as PropertyId)) {
        throw inboxError('forbidden', 'No access to this property', {
          propertyId: input.propertyId,
        })
      }
      propertyIds = visible
    }

    // An explicit property filter narrows the count to that property;
    // otherwise the count spans every accessible property (org-wide for
    // org-wide roles).
    const scoped: ReadonlyArray<PropertyId> | undefined = input.propertyId
      ? [input.propertyId as PropertyId]
      : propertyIds

    const [open, escalated, closed] = await Promise.all([
      deps.repo.countByStatus(ctx.organizationId, 'open', scoped, sourceScopes),
      deps.repo.countEscalatedActive(ctx.organizationId, scoped, sourceScopes),
      deps.repo.countByStatus(ctx.organizationId, 'closed', scoped, sourceScopes),
    ])

    return { open, escalated, closed }
  }
