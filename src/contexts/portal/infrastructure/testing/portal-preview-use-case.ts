// Test-only: the editor's preview use case over the real repositories, for the
// suites that prove what the draft preview shows of a working copy seeded by SQL.
// Not imported by production code.

import type { Pool } from 'pg'
import { getDb } from '#/shared/db'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { PORTAL_DESTINATION_VALIDATION_VERSION } from '../../domain/approved-destination'
import { getPortalPreview } from '../../application/use-cases/get-portal-preview'
import { createPortalRepository } from '../repositories/portal.repository'
import { createPortalLinkRepository } from '../repositories/portal-link.repository'
import { createPortalExperienceRepository } from '../repositories/portal-experience.repository'
import { createPortalApprovedDestinationRepository } from '../repositories/portal-approved-destination.repository'
import { createPortalMediaAssetRepository } from '../repositories/portal-media-asset.repository'
import { createPortalPublicationRepository } from '../repositories/portal-publication.repository'
import { createPortalLookRepository } from '../repositories/portal-look.repository'
import {
  seedPortalWorkingCopy,
  type PortalWorkingCopySeed,
} from './portal-working-copy-seed'

const PREVIEW_NOW = new Date('2026-10-01T12:00:00.000Z')

const staffPublicApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
}

export function createPreviewUseCase() {
  const db = getDb()
  return getPortalPreview({
    portalRepo: createPortalRepository(db),
    portalLinkRepo: createPortalLinkRepository(db, () => PREVIEW_NOW),
    experienceRepo: createPortalExperienceRepository(db),
    portalLookRepo: createPortalLookRepository(db),
    destinationRepo: createPortalApprovedDestinationRepository(db),
    publicationRepo: createPortalPublicationRepository(db),
    mediaRepo: createPortalMediaAssetRepository(db),
    propertyFacts: { getPropertyTimezone: async () => 'Europe/Sofia' },
    staffPublicApi,
    clock: () => PREVIEW_NOW,
  })
}

/** The shared seed writes a validation version the repository (rightly) refuses to read. */
export async function seedScenarioForPreview(
  pool: Pool,
  scenario: PortalWorkingCopySeed,
): Promise<void> {
  await seedPortalWorkingCopy(pool, scenario)
  await pool.query(
    `UPDATE portal_approved_destinations SET validation_version = $1 WHERE organization_id = $2`,
    [PORTAL_DESTINATION_VALIDATION_VERSION, scenario.organizationId],
  )
}
