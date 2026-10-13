// AI — the Property decision a dashboard-facing AI read makes first
// (docs/standards.md §2.2 step 1; AI CONTEXT.md Invariant 3).
//
// The Property aggregate and insights reports are dashboard reads: there is no
// analysis-read permission, so the reader needs `dashboard.read` on the
// Property, the permission their server functions ask the execution policy
// about. It is asked here as well because the use case is what `aiPublicApi`
// publishes: a caller that is not one of those server functions would
// otherwise read any Property of the Organization. Whether the merchant
// authorized the capability is a separate question (`resolveAiReadGate`),
// asked after this one.

import type { AuthContext } from '#/shared/domain/auth-context'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import {
  mayUsePermissionOnProperties,
  type PropertyAccessLookup,
} from '#/shared/domain/property-access'
import { aiError } from '../domain/errors'

/** Identity's current-grant lookup, as the composition root binds it. */
export type AiPropertyAccess = PropertyAccessLookup

/** Refuse, as a tagged `forbidden`, a reader who may not read this Property. */
export async function requireAiPropertyReadAccess(
  propertyAccess: AiPropertyAccess,
  actor: AuthContext,
  scope: Readonly<{ organizationId: OrganizationId; propertyId: PropertyId }>,
): Promise<void> {
  const allowed = await mayUsePermissionOnProperties(
    propertyAccess,
    actor,
    'dashboard.read',
    { organizationId: scope.organizationId, propertyIds: [scope.propertyId] },
  )
  if (!allowed) {
    throw aiError('forbidden', 'Property is not readable by this caller')
  }
}
