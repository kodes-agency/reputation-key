// Inbox context — shared access guards reused by inbox item use cases.
// Per architecture: application-layer helpers may import domain, ports, and
// shared/domain only. They must NOT import infrastructure or server modules.

import type { InboxRepository, InboxSourceScope } from './ports/inbox.repository'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { InboxItem } from '../domain/types'
import type { SourceType } from '../domain/types'
import type { InboxItemId, OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import { canForContext, type Permission } from '#/shared/domain/permissions'
import { isPropertyAccessibleForPermission } from '#/shared/domain/property-access'
import { getAccessiblePropertyIdsForPermission } from '#/shared/domain/property-access'
import { inboxError, REVISION_CONFLICT_MESSAGE } from '../domain/errors'

const SOURCE_READ_PERMISSION = {
  review: 'review.read',
  feedback: 'feedback.read',
} as const satisfies Readonly<Record<SourceType, Permission>>

const SOURCE_HANDLE_PERMISSION = {
  review: 'review.read',
  feedback: 'feedback.handle',
} as const satisfies Readonly<Record<SourceType, Permission>>

/** Source content is visible only when both the Inbox and its owning context
 * grant read access. This matters for custom roles that can use Inbox without
 * being allowed to read private feedback. */
export const canReadInboxSource = (ctx: AuthContext, sourceType: SourceType): boolean =>
  canForContext(ctx, 'inbox.read') &&
  canForContext(ctx, SOURCE_READ_PERMISSION[sourceType])

/** Inbox workflow rights do not by themselves authorize handling private
 * feedback. Review work retains its Review read prerequisite; private feedback
 * additionally requires the dedicated internal-handling permission. */
export const canHandleInboxSource = (ctx: AuthContext, sourceType: SourceType): boolean =>
  canForContext(ctx, 'inbox.write') &&
  canForContext(ctx, SOURCE_HANDLE_PERMISSION[sourceType])

export const readableInboxSourceTypes = (ctx: AuthContext): SourceType[] =>
  (['review', 'feedback'] as const).filter((sourceType) =>
    canReadInboxSource(ctx, sourceType),
  )

type InboxSourceAccessKind = 'read' | 'handle'

const intersectPropertyScopes = (
  base: ReadonlyArray<PropertyId> | null,
  source: ReadonlyArray<PropertyId> | null,
): ReadonlyArray<PropertyId> | null => {
  if (base === null) return source
  if (source === null) return base
  const sourceIds = new Set(source)
  return base.filter((id) => sourceIds.has(id))
}

/**
 * Resolve the source/property visibility envelope for list and count queries.
 * Every returned predicate is the intersection of the Inbox permission and
 * its owning context permission; omitted source families match no rows.
 */
export const resolveInboxSourceScopes = async (
  staffPublicApi: StaffPublicApi,
  ctx: AuthContext,
  kind: InboxSourceAccessKind,
): Promise<ReadonlyArray<InboxSourceScope>> => {
  const basePermission: Permission = kind === 'read' ? 'inbox.read' : 'inbox.write'
  if (!canForContext(ctx, basePermission)) return []

  const lookup = (
    orgId: OrganizationId,
    userId: AuthContext['userId'],
    orgWide: boolean,
  ) => staffPublicApi.getAccessiblePropertyIds(orgId, userId, orgWide)
  const baseScope = await getAccessiblePropertyIdsForPermission(
    lookup,
    ctx,
    basePermission,
  )
  const permissionBySource =
    kind === 'read' ? SOURCE_READ_PERMISSION : SOURCE_HANDLE_PERMISSION
  const scopes: InboxSourceScope[] = []

  for (const sourceType of ['review', 'feedback'] as const) {
    const sourcePermission = permissionBySource[sourceType]
    if (!canForContext(ctx, sourcePermission)) continue
    const sourceScope = await getAccessiblePropertyIdsForPermission(
      lookup,
      ctx,
      sourcePermission,
    )
    const propertyIds = intersectPropertyScopes(baseScope, sourceScope)
    if (propertyIds?.length === 0) continue
    scopes.push(propertyIds === null ? { sourceType } : { sourceType, propertyIds })
  }

  return scopes
}

/** Assert both halves of a source-specific property authorization. */
export const assertInboxSourcePropertyAccessible = async (
  staffPublicApi: StaffPublicApi,
  ctx: AuthContext,
  kind: InboxSourceAccessKind,
  sourceType: SourceType,
  propertyId: PropertyId,
): Promise<void> => {
  const basePermission: Permission = kind === 'read' ? 'inbox.read' : 'inbox.write'
  const sourcePermission =
    kind === 'read'
      ? SOURCE_READ_PERMISSION[sourceType]
      : SOURCE_HANDLE_PERMISSION[sourceType]
  await assertPropertyAccessible(staffPublicApi, ctx, basePermission, propertyId)
  await assertPropertyAccessible(staffPublicApi, ctx, sourcePermission, propertyId)
}

export const isInboxSourcePropertyWithinScopes = (
  scopes: ReadonlyArray<InboxSourceScope>,
  sourceType: SourceType,
  propertyId: PropertyId,
): boolean =>
  scopes.some(
    (scope) =>
      scope.sourceType === sourceType &&
      (scope.propertyIds === undefined || scope.propertyIds.includes(propertyId)),
  )

/** Finds an inbox item by id, throwing `not_found` when it does not exist. */
export const loadInboxItemOrThrow = async (
  repo: InboxRepository,
  id: InboxItemId,
  organizationId: OrganizationId,
): Promise<InboxItem> => {
  const item = await repo.findById(id, organizationId)
  if (!item) {
    throw inboxError('not_found', 'Inbox item not found', { inboxItemId: id })
  }
  return item
}

/** Reject stale client intent before deriving a command fact. The command
 * store repeats this fence in PostgreSQL so a later race still commits
 * neither state nor fact. */
export const assertExpectedCommandRevision = (
  item: InboxItem,
  expectedCommandRevision: number,
): void => {
  if (item.commandRevision === expectedCommandRevision) return
  throw inboxError('revision_conflict', REVISION_CONFLICT_MESSAGE, {
    expectedCommandRevision,
    currentCommandRevision: item.commandRevision,
    currentStatus: item.status,
    currentAssignedTo: item.assignedTo,
    currentEscalated: item.isEscalated && item.escalationResolvedAt === null,
  })
}

/** Throws `forbidden` when the caller lacks access to the given property.
 *
 *  Scope is resolved PER PERMISSION via scopeForPermission: org-wide scope
 *  (AccountAdmin) → all accessible; assigned scope (PropertyManager/Staff) →
 *  the caller's staff_assignment properties. Note: PM holds `inbox.manage`
 *  but inbox visibility is governed by inbox.read/inbox.write scope, which is
 *  assigned for PM — so gating on `can(role,'inbox.manage')` would wrongly
 *  grant PM org-wide access (CONTEXT.md L72). */
export const assertPropertyAccessible = async (
  staffPublicApi: StaffPublicApi,
  ctx: AuthContext,
  permission: Permission,
  propertyId: PropertyId,
): Promise<void> => {
  const accessible = await isPropertyAccessibleForPermission(
    (orgId, uId, orgWide) => staffPublicApi.getAccessiblePropertyIds(orgId, uId, orgWide),
    ctx,
    permission,
    propertyId,
  )
  if (!accessible) {
    throw inboxError('forbidden', 'No access to this property', { propertyId })
  }
}
