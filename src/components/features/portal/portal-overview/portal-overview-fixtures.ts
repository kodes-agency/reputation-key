// Overview rows for tests and stories. One builder, so a field added to
// `PortalOverviewRow` is added once, and every fixture says only what it cares
// about: the default is a live, healthy Portal with a working code and a manager.
import type { PortalOverviewRow } from '#/contexts/portal/application/public-api'
import { portalGroupId, portalId, propertyId } from '#/shared/domain/ids'

const WORKING_CODE: PortalOverviewRow['token'] = {
  hasActiveToken: true,
  qualifiedScanReady: true,
  version: 1,
  issuedAt: '2026-09-01T09:00:00.000Z',
  graceExpiresAt: null,
  addressRecoverable: false,
}

export const NO_CODE: PortalOverviewRow['token'] = {
  hasActiveToken: false,
  qualifiedScanReady: false,
  version: null,
  issuedAt: null,
  graceExpiresAt: null,
  addressRecoverable: false,
}

export const overviewGroup = (id: string, name: string) => ({
  id: portalGroupId(id),
  name,
})

export function overviewRow(
  id: string,
  overrides: Partial<Omit<PortalOverviewRow, 'portalId'>> = {},
): PortalOverviewRow {
  return {
    portalId: portalId(id),
    propertyId: propertyId('prop-1'),
    name: id,
    slug: id,
    publicationState: 'published',
    primaryGuestLocale: 'en',
    additionalGuestLocales: [],
    health: { status: 'healthy', reason: 'operational' },
    pendingChangeCount: 0,
    group: null,
    responsibleManagerUserIds: ['user-1'],
    token: WORKING_CODE,
    ...overrides,
  }
}
