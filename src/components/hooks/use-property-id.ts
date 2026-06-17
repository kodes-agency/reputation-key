import { useRouterState } from '@tanstack/react-router'

/**
 * Resolve the active property id from the URL.
 *
 * The `/properties/$propertyId` path segment takes precedence; otherwise fall
 * back to a `?propertyId=` search param carried by cross-property pages
 * (inbox, fleet overview) — see ADR 0016.
 *
 * Used by the property switcher and property-aware navigation.
 */
export function usePropertyId(): string | null {
  return useRouterState({
    select: (s) => {
      const m = s.location.pathname.match(/\/properties\/([^/]+)/)
      if (m) return m[1]
      const search = s.location.search as { propertyId?: string } | undefined
      return search?.propertyId ?? null
    },
  })
}
