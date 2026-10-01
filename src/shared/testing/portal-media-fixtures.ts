// Test-only builders for Portal media assets.

import { randomUUID } from 'node:crypto'
import type { PortalMediaAsset } from '#/contexts/portal/domain/portal-media-asset'
import {
  organizationId,
  portalMediaAssetId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { portalMediaObjectKey } from '#/shared/domain/portal-media'

/** A valid stored asset. The object key always follows the id, as the database demands. */
export function buildTestPortalMediaAsset(
  overrides: Partial<PortalMediaAsset> = {},
): PortalMediaAsset {
  const id = overrides.id ?? portalMediaAssetId(randomUUID())
  return {
    id,
    organizationId: organizationId('org-00000000-0000-0000-0000-000000000001'),
    propertyId: propertyId('a0000000-0000-0000-0000-000000000001'),
    purpose: 'hero',
    status: 'active',
    objectKey: portalMediaObjectKey(id),
    contentType: 'image/webp',
    width: 2400,
    height: 1600,
    byteSize: 180_000,
    contentSha256: 'a'.repeat(64),
    sourceFormat: 'jpeg',
    sourceBytes: 2_500_000,
    rightsConfirmedAt: new Date('2026-10-01T10:00:00Z'),
    createdBy: userId('user-00000000-0000-0000-0000-000000000001'),
    createdAt: new Date('2026-10-01T10:00:00Z'),
    takenDownAt: null,
    ...overrides,
  }
}
