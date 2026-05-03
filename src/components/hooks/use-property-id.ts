import { useRouterState } from '@tanstack/react-router'

/**
 * Extract the current propertyId from the URL path.
 * Used by ManagerSidebar for property-aware navigation.
 */
export function usePropertyId(): string | null {
  return useRouterState({
    select: (s) => {
      const m = s.location.pathname.match(/\/properties\/([^/]+)/)
      return m?.[1] ?? null
    },
  })
}
