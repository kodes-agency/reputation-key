import { hasFailed } from '#/components/hooks/is-retrying'
import { PortalReadState } from '#/components/features/portal/portal-detail/portal-read-state'
// Publication status and group labels load locally, so a failed status read
// cannot replace the workspace. Publish affordances wait for those facts.
import { notFound, useRouter } from '@tanstack/react-router'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { usePermissions } from '#/shared/hooks/usePermissions'
import {
  canReviewAndPublish,
  describePendingChanges,
  type PortalDetailTab,
} from '#/components/features/portal/portal-detail/portal-detail-rules'
import type { PortalEditorSection } from '#/contexts/portal/editor/ui/portal-editor-sections'
import { PortalDraftSaveStatus } from '#/contexts/portal/editor/ui/portal-draft-save-status'
import { PortalOpenPageControl } from '#/components/features/portal/portal-workspace/portal-open-page-control'
import { PortalWorkspaceHeader } from '#/components/features/portal/portal-workspace/portal-workspace-header'
import {
  workspaceBackTarget,
  type WorkspaceOriginLocation,
} from '#/components/features/portal/portal-workspace/portal-workspace-origin'
import {
  hasSomethingToPublish,
  workspaceStatus,
} from '#/components/features/portal/portal-workspace/portal-workspace-status'
import { propertyQuery } from '#/routes/-queries/route-queries'
import { usePortalOpenPageReveal } from './-portal-detail-actions'
import {
  portalGroupsQuery,
  portalPublicationHistoryQuery,
  portalQuery,
} from './-portal-detail-data'

type Props = Readonly<{
  propertyId: string
  portalId: string
  reviewing: boolean
  activeTab: PortalDetailTab
  activeSection?: PortalEditorSection
}>

/**
 * The location the manager was on before the workspace opened. The router marks
 * a navigation resolved only after the new page has rendered, so on the first
 * render this is still the page the manager left; it is read once and kept, so
 * moving between tabs and sections does not change where the way back leads. On
 * a first load (or the server) it is the workspace itself, which leads to the
 * property's list.
 */
function useOriginOnce(): WorkspaceOriginLocation | undefined {
  const router = useRouter()
  const [origin] = useState(() => {
    const resolved = router.state.resolvedLocation
    return resolved === undefined
      ? undefined
      : {
          pathname: resolved.pathname,
          search: resolved.search as Readonly<Record<string, unknown>>,
        }
  })
  return origin
}

export function PortalWorkspaceHeaderSlot({
  propertyId,
  portalId,
  reviewing,
  activeTab,
  activeSection,
}: Props) {
  const origin = useOriginOnce()
  const { has } = useCapabilities()
  const { can } = usePermissions()
  const { data: portalData } = useSuspenseQuery(portalQuery(portalId))
  const { data: propData } = useSuspenseQuery(propertyQuery(propertyId))
  const historyQuery = useQuery(portalPublicationHistoryQuery(portalId))
  const groupsQuery = useQuery(portalGroupsQuery(propertyId))
  const revealForOpenPage = usePortalOpenPageReveal()
  const { portal, tokenStatus } = portalData
  if (!portal) throw notFound()

  const queries = [historyQuery, groupsQuery]
  if (
    queries.some((query) => query.data === undefined && hasFailed(query)) ||
    !historyQuery.data ||
    !groupsQuery.data
  ) {
    return <PortalReadState queries={queries} label="portal status" />
  }
  const history = historyQuery.data
  const groupsData = groupsQuery.data
  const access = {
    canUpdate: can('portal.update'),
    portalWriteEnabled: has('portal.write'),
  }
  const groupName = (groupId: string) =>
    groupsData.groups.find((group) => group.id === groupId)?.name ?? null
  const status = workspaceStatus({
    publicationState: portal.publicationState,
    propertyAvailable: propData.property.lifecycleState === 'active',
    hasLiveVersion: history.current !== null,
    token: tokenStatus,
    liveVersion: history.current?.version ?? null,
    hasPendingChanges: history.hasPendingChanges,
  })
  return (
    <PortalWorkspaceHeader
      mode={reviewing ? 'review' : 'edit'}
      propertyId={propertyId}
      portalId={portalId}
      portalName={portal.name}
      publicName={
        has('staff.accounts') && portal.kind === 'personal'
          ? (portal.publicName ?? undefined)
          : undefined
      }
      propertyName={propData.property.name}
      statusLine={status.line}
      statusProblem={status.problem}
      pendingNote={describePendingChanges(history)}
      canReview={canReviewAndPublish(access, portal.publicationState)}
      publishWaiting={hasSomethingToPublish(
        portal.publicationState,
        history.hasPendingChanges,
      )}
      back={workspaceBackTarget(origin, propertyId, groupName)}
      activeTab={activeTab}
      activeSection={activeSection}
      saveStatus={<PortalDraftSaveStatus />}
      openPage={
        <PortalOpenPageControl
          propertyId={propertyId}
          portalId={portalId}
          canUpdate={access.canUpdate}
          portalWriteEnabled={access.portalWriteEnabled}
          publicationState={portal.publicationState}
          tokenStatus={tokenStatus}
          activeTab={activeTab}
          revealMutation={revealForOpenPage}
        />
      }
    />
  )
}
