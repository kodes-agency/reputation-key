// AI — the Property decision a reader-facing AI read makes first
// (docs/standards.md §2.2 step 1; AI CONTEXT.md Invariant 3).
//
// Every read `aiPublicApi` serves for a reader takes that reader's AuthContext
// and asks here, with the permission its own surface is gated on: the reader
// belongs to the Organization, holds the permission, and it reaches the
// Property. The server functions ask the execution policy the same question,
// and Inbox authorizes its item; it is asked here as well because the use case
// is what `aiPublicApi` publishes, so a caller that is neither would otherwise
// read any Property of the Organization. Whether the merchant authorized the
// capability is a separate question (`resolveAiReadGate`), asked after this
// one.

import type { AuthContext } from '#/shared/domain/auth-context'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { Permission } from '#/shared/domain/permissions'
import {
  mayUsePermissionOnProperties,
  type PropertyAccessLookup,
} from '#/shared/domain/property-access'
import { aiError } from '../domain/errors'

/** Identity's current-grant lookup, as the composition root binds it. */
export type AiPropertyAccess = PropertyAccessLookup

/**
 * The permission each reader-facing read asks for. There is no analysis-read
 * permission: the aggregate, insights and progress reports are dashboard
 * reads, the trend has its own, and one review's analysis is read where the
 * review is, in the Inbox.
 */
export type AiReadPermission = Extract<
  Permission,
  'dashboard.read' | 'ai.trends.read' | 'inbox.read'
>

/** Refuse, as a tagged `forbidden`, a reader who may not read this Property. */
export async function requireAiPropertyReadAccess(
  propertyAccess: AiPropertyAccess,
  actor: AuthContext,
  permission: AiReadPermission,
  scope: Readonly<{ organizationId: OrganizationId; propertyId: PropertyId }>,
): Promise<void> {
  const allowed = await mayUsePermissionOnProperties(propertyAccess, actor, permission, {
    organizationId: scope.organizationId,
    propertyIds: [scope.propertyId],
  })
  if (!allowed) {
    throw aiError('forbidden', 'Property is not readable by this caller')
  }
}
