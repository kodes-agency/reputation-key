// BETA-2 B2.2: Bounded property query infrastructure.
//
// The root layout currently loads ALL properties for the organization.
// At target scale (5,000 properties), this is unsustainable.
//
// This module provides:
// 1. A bounded properties result type (first N + total count)
// 2. A server-side search function interface
// 3. A MAX_ROOT_PROPERTIES constant for the root loader limit
//
// Migration path:
// - Phase 1 (now): Root loader limits to MAX_ROOT_PROPERTIES + shows count
// - Phase 2: Sidebar uses server-side search for > MAX results
// - Phase 3: Full cursor pagination everywhere

/** Maximum properties loaded in the root layout. */
export const MAX_ROOT_PROPERTIES = 100

/** Maximum properties returned per search query. */
export const MAX_SEARCH_RESULTS = 50

/** Minimum search query length before searching (prevents broad scans). */
export const MIN_SEARCH_LENGTH = 2

/**
 * Bounded property list result — includes the first N properties
 * and the total count so the UI can show "showing 100 of 5,000".
 */
export type BoundedPropertiesResult = Readonly<{
  properties: readonly {
    id: string
    name: string
    slug: string
  }[]
  totalCount: number
  hasMore: boolean
}>

/**
 * Check if a search query meets the minimum length requirement.
 */
export function meetsMinSearchLength(query: string): boolean {
  return query.trim().length >= MIN_SEARCH_LENGTH
}

/**
 * Create a bounded result from a full property list.
 * Used during the transition period before server-side search.
 */
export function createBoundedResult(
  allProperties: readonly { id: string; name: string; slug: string }[],
  limit: number = MAX_ROOT_PROPERTIES,
): BoundedPropertiesResult {
  return {
    properties: allProperties.slice(0, limit),
    totalCount: allProperties.length,
    hasMore: allProperties.length > limit,
  }
}
