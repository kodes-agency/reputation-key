// Changing the Inbox's property scope. "All properties" is the organization-wide
// Inbox; a property is its own Reviews page, so the app's property context
// follows the scope. Queue, filters and sort survive the move — the opened item
// does not, because it may not belong to the new scope.
//
// Every scope control goes through here — the rail, the compact scope menu and
// the app tile inside the Inbox — so the rule that choosing the scope already in
// view does nothing holds for all of them. That choice changes no scope, so it
// must not close the open item or add a history entry either.
import { useCallback } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { propertyIdFromLocation } from '#/components/hooks/use-property-id'

/**
 * Search carried across a scope change: the queue, filters and sort stay; an
 * item opened under the old scope, and the old scope itself, do not.
 */
export function searchAfterInboxScopeChange(search: unknown): Record<string, unknown> {
  if (search === null || typeof search !== 'object') return {}

  return Object.fromEntries(
    Object.entries(search).filter(([key]) => key !== 'itemId' && key !== 'propertyId'),
  )
}

/** Whether `propertyId` (null for All properties) is the scope this location shows. */
export function isInboxScopeInView(
  location: Readonly<{ pathname: string; search: unknown }>,
  propertyId: string | null,
): boolean {
  return propertyIdFromLocation(location.pathname, location.search) === propertyId
}

export function useInboxScopeNavigation(): (propertyId: string | null) => void {
  const navigate = useNavigate()
  const location = useRouterState({ select: (state) => state.location })

  return useCallback(
    (propertyId: string | null) => {
      if (isInboxScopeInView(location, propertyId)) return
      const nextSearch = searchAfterInboxScopeChange(location.search)
      if (propertyId === null) {
        void navigate({ to: '/inbox', search: nextSearch })
        return
      }
      void navigate({
        to: '/properties/$propertyId/reviews',
        params: { propertyId },
        search: nextSearch,
      })
    },
    [navigate, location],
  )
}
