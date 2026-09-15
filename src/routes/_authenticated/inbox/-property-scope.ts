// The Inbox's property choices as route data: the workspace properties this
// viewer can see, where the Inbox stands among them, and how to move it. Shared
// by the two routes that render the Inbox — the organization-wide `/inbox` and a
// property's own Reviews page.
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { partitionWorkspaceProperties } from '#/components/features/property/property-workspace'
import type { InboxPropertyScopeInput } from '#/components/inbox/inbox-property-scope'
import { useInboxScopeNavigation } from '#/components/inbox/use-inbox-scope-navigation'
import { propertiesQuery } from '#/routes/-queries/route-queries'

export function useInboxRouteScope(
  activePropertyId: string | null,
  includeAll: boolean,
): Readonly<{ propertyScope: InboxPropertyScopeInput; scopeLabel: string }> {
  const { data } = useQuery(propertiesQuery)
  const onSelect = useInboxScopeNavigation()
  // Removed properties stay out of the choices, as they do in the navigation.
  const properties = useMemo(
    () => partitionWorkspaceProperties(data?.properties ?? []).workspace,
    [data],
  )
  const activeName = data?.properties.find(
    (property) => property.id === activePropertyId,
  )?.name

  return {
    propertyScope: { properties, activePropertyId, includeAll, onSelect },
    scopeLabel: activePropertyId ? (activeName ?? 'Property') : 'All properties',
  }
}
