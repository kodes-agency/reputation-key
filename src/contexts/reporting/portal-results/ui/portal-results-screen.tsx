import type { ComponentProps, ReactNode } from 'react'
import type { PortalOverviewRow } from '#/contexts/portal/application/public-api'
import { hasUncountedScans } from '#/components/features/portal/portal-overview/portal-attention'
import { PortalAnalyticsTab } from './portal-analytics-tab'

export function PortalResultsScreen({
  portal,
  propertyId,
  tokenStatus,
  getPortalAnalytics,
  goalLine,
  goalLinePending,
}: Readonly<{
  portal: Pick<PortalOverviewRow, 'publicationState' | 'skipPrivateRating'> &
    Readonly<{ id: string }>
  propertyId: string
  tokenStatus: PortalOverviewRow['token']
  getPortalAnalytics: ComponentProps<typeof PortalAnalyticsTab>['getPortalAnalytics']
  goalLine?: ReactNode
  goalLinePending?: boolean
}>) {
  return (
    <PortalAnalyticsTab
      skipPrivateRating={portal.skipPrivateRating}
      portalId={portal.id}
      propertyId={propertyId}
      getPortalAnalytics={getPortalAnalytics}
      // A portal guests cannot open has nothing to count: its Results says to publish.
      pageIsLive={portal.publicationState === 'published'}
      publicationState={portal.publicationState}
      // The same answer as the Portals overview's dash with "Not counted: older code".
      scansCounted={
        !hasUncountedScans({
          publicationState: portal.publicationState,
          token: tokenStatus,
        })
      }
      goalLine={goalLine}
      goalLinePending={goalLinePending}
    />
  )
}
