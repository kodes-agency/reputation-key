// Inbox context — review source-metadata lookup adapter (BQC-3.4).
// Implements ReviewSourceLookupPort by delegating to the Review context's
// repository methods, injected via deps (ADR-0008: no review-context module
// is imported; review's Review row satisfies ReviewSourceRow structurally).
// Serves projection-owned metadata only — never content fields.

import type {
  ReviewSourceLookupPort,
  ReviewSourceMeta,
} from '../../application/ports/review-source-lookup.port'
import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'

/** Structural shape the review repository rows satisfy (metadata only). */
export type ReviewSourceRow = Readonly<{
  id: ReviewId
  propertyId: PropertyId
  platform: string
  reviewedAt: Date
  contentExpiresAt: Date | null
}>

const toMeta = (row: ReviewSourceRow): ReviewSourceMeta => ({
  id: row.id,
  propertyId: row.propertyId,
  platform: row.platform,
  sourceDate: row.reviewedAt,
  contentExpiresAt: row.contentExpiresAt,
})

export const createReviewSourceLookupAdapter = (deps: {
  findById: (id: ReviewId, orgId: OrganizationId) => Promise<ReviewSourceRow | null>
  findByOrganizationId: (orgId: OrganizationId) => Promise<ReadonlyArray<ReviewSourceRow>>
  findByPropertyId: (
    propertyId: PropertyId,
    orgId: OrganizationId,
  ) => Promise<ReadonlyArray<ReviewSourceRow>>
}): ReviewSourceLookupPort => ({
  getReviewSourceMetaById: async (id, orgId) => {
    const row = await deps.findById(id, orgId)
    return row ? toMeta(row) : null
  },
  listReviewSources: async (orgId, propertyId) => {
    const rows = propertyId
      ? await deps.findByPropertyId(propertyId, orgId)
      : await deps.findByOrganizationId(orgId)
    return rows.map(toMeta)
  },
})
