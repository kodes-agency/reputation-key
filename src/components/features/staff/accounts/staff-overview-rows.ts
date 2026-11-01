import type { PortalOverviewRow } from '#/contexts/portal/application/public-api'
import { portalId, portalGroupId, propertyId } from '#/shared/domain/ids'
import type { StaffMember } from './staff-account-view'
/** An interrupted setup stays repairable even before it has created a Portal. */
export function withStaffSetupRows(
  rows: readonly PortalOverviewRow[],
  members: readonly StaffMember[],
  scope: string,
): readonly PortalOverviewRow[] {
  const known = new Set(rows.map((row) => String(row.portalId)))
  const missing = members.filter(
    (member) =>
      member.access === 'failed' && !known.has(member.portalId ?? member.participationId),
  )
  return [
    ...rows,
    ...missing.map((member): PortalOverviewRow => ({
      portalId: portalId(member.portalId ?? member.participationId),
      propertyId: propertyId(scope),
      kind: 'personal',
      name: member.displayName,
      slug: member.participationId,
      publicationState: 'draft',
      skipPrivateRating: false,
      primaryGuestLocale: 'en',
      additionalGuestLocales: [],
      health: null,
      pendingChangeCount: 0,
      group: member.group
        ? { id: portalGroupId(member.group.id), name: member.group.name }
        : null,
      responsibleManagerUserIds: [],
      token: {
        hasActiveToken: false,
        qualifiedScanReady: false,
        version: null,
        issuedAt: null,
        graceExpiresAt: null,
        addressRecoverable: false,
        madeBy: null,
      },
    })),
  ]
}
