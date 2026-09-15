// Changing the Inbox's property scope. "All properties" is the organization-wide
// Inbox; a property is its own Reviews page, so the app's property context
// follows the scope. Queue, filters and sort survive the move — the opened item
// does not, because it may not belong to the new scope.
import { useCallback } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { searchAfterInboxScopeChange } from './inbox-property-scope'

export function useInboxScopeNavigation(): (propertyId: string | null) => void {
  const navigate = useNavigate()
  const search = useRouterState({ select: (state) => state.location.search })

  return useCallback(
    (propertyId: string | null) => {
      const nextSearch = searchAfterInboxScopeChange(search)
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
    [navigate, search],
  )
}
