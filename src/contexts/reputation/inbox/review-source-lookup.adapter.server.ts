// Inbox context — review source-metadata lookup adapter.
// Implements ReviewSourceLookupPort by delegating to the Review context's
// repository methods, injected via deps (ADR-0008: no review-context module
// is imported; review's Review row satisfies ReviewSourceRow structurally).
// Serves projection-owned metadata only — never content fields.

import type {
  ReviewSourceLookupPort,
  ReviewSourceMeta,
} from './review-source-lookup.port.server'
import type {
  ReviewSourceLookupSource,
  ReviewSourceRow,
} from './lookup-sources.port.server'

const toMeta = (row: ReviewSourceRow): ReviewSourceMeta => ({
  id: row.id,
  propertyId: row.propertyId,
  platform: row.platform,
  sourceEpoch: row.sourceEpoch,
  sourceDate: row.reviewedAt,
  contentExpiresAt: row.contentExpiresAt,
  materialReviewRevision: row.sourceRevision ?? null,
})

export const createReviewSourceLookupAdapter = (
  deps: ReviewSourceLookupSource,
): ReviewSourceLookupPort => ({
  getReviewSourceMetaById: async (id, orgId) => {
    const row = await deps.findById(id, orgId)
    return row ? toMeta(row) : null
  },
  getReviewSourceMetaByIds: async (ids, orgId) => {
    const rows = await deps.findByIds(ids, orgId)
    return rows.map(toMeta)
  },
  listReviewSources: async (orgId, propertyId) => {
    const rows = propertyId
      ? await deps.findByPropertyId(propertyId, orgId)
      : await deps.findByOrganizationId(orgId)
    return rows.map(toMeta)
  },
})
