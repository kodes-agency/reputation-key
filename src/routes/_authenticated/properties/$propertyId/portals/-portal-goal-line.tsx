// A Portal's Results line for the Monthly portal goal (PLAN PG-16): read through
// the Goals route's Portal-goal queries, only for someone who may set the goal
// (`goal.create`, with Goals on), only on the Results tab, and never for a
// draft Portal, which has no line. While it is read the tab keeps its loading
// state, so a line that arrives moves nothing below it; a read that fails is no
// line, and the tab shows its figures.
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { PortalDetailPortal } from '#/components/features/portal/portal-detail/portal-detail-types'
import { PortalGoalResultsLine } from '#/components/goals/portal-goal-results-line'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { portalGoalLineQuery } from '../goals/-portal-goal-queries'

type LineHost = Readonly<{
  propertyId: string
  portal: Pick<PortalDetailPortal, 'id' | 'name' | 'publicationState'>
  /** The Results tab is the one shown: the line is read only there. */
  onResults: boolean
}>

export function usePortalGoalLine({
  propertyId,
  portal,
  onResults,
}: LineHost): Readonly<{ line: ReactNode; pending: boolean }> {
  const { can } = usePermissions()
  const { has } = useCapabilities()
  const shown =
    onResults &&
    can('goal.create') &&
    has('goal.use') &&
    has('dashboard.use') &&
    portal.publicationState !== 'draft'
  const read = useQuery({
    ...portalGoalLineQuery(propertyId, portal.id),
    enabled: shown,
    retry: false,
  })
  if (!shown) return { line: null, pending: false }
  return {
    line:
      read.data === undefined ? null : (
        <PortalGoalResultsLine
          line={read.data}
          portalName={portal.name}
          propertyId={propertyId}
        />
      ),
    pending: read.isPending,
  }
}
