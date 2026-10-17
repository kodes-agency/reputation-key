// Inbox context — property lookup adapter
// Implements PropertyLookupPort by delegating to the Property context's public API.
// Cross-context SQL is encapsulated here in the infrastructure layer where it's acceptable.

import { googleReviewsPageForDestination } from '#/shared/domain/google-review-links'
import type { PropertyLookupPort } from '../../application/ports/property-lookup.port'
import type { PropertyLookupSource } from '../../application/ports/lookup-sources.port'

export const createPropertyLookupAdapter = (
  deps: PropertyLookupSource,
): PropertyLookupPort => ({
  getPropertyNameById: (pid, orgId) => deps.getPropertyName(orgId, pid),

  getPropertyReplyLanguageById: (pid, orgId) =>
    deps.getPropertyReplyLanguage?.(orgId, pid) ?? Promise.resolve(null),

  // Only a verified destination is a rendering authority: one fenced as
  // `awaiting_refresh` (an archived Property, a disconnected binding) or
  // `unavailable` offers no page, as it offers no Portal Google action.
  getPropertyGoogleReviewsPageById: async (pid, orgId) => {
    const destination = (await deps.getGoogleReviewDestination?.(orgId, pid)) ?? null
    return destination?.state === 'verified' && destination.uri !== null
      ? googleReviewsPageForDestination(destination.uri)
      : null
  },

  getPropertyNamesByIds: async (propertyIds, orgId) => {
    const map = new Map<string, string | null>()
    if (propertyIds.length === 0) return map
    const rows = await deps.getPropertyNames(orgId, propertyIds)
    for (const r of rows) {
      map.set(r.id, r.name)
    }
    return map
  },
})
