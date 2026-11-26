import type { PropertyLookupPort } from '#/contexts/reputation/inbox/property-lookup.port.server'

/** A lookup that knows no Property: every read answers as an unnamed, unconfigured one. */
export const inertPropertyLookup = {
  getPropertyNameById: async () => null,
  getPropertyNamesByIds: async () => new Map(),
  getPropertyReplyLanguageById: async () => null,
  getPropertyGoogleReviewsPageById: async () => null,
} satisfies PropertyLookupPort
