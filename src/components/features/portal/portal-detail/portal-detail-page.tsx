// Portal detail page — tabbed layout controlled by typed route search state.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { ArrowLeft, Eye } from 'lucide-react'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { PortalDetailTabs } from './portal-detail-tabs'
import { PortalUnsavedChangesPrompt } from './portal-unsaved-changes-prompt'
import { PortalSettings } from '../portal-settings/portal-settings'
import { LinkTree } from '../link-tree/link-tree'
import { PortalShare, type IssuedPortalLink } from '../portal-share/portal-share'
import { PortalAnalyticsTab } from '../portal-analytics/portal-analytics-tab'
import { usePreviewToggle } from '../portal-preview/use-preview-toggle'
import { PortalDetailPreview } from './portal-detail-preview'
import type { Action } from '#/components/hooks/use-action'
import type { LinkTreeCategory, LinkTreeLink } from '../link-tree/link-tree-types'
import type {
  CompleteReviewResult,
  CompleteReviewVariables,
  FormLike,
  PortalPublicationState,
  PortalThemeDraft,
  UpdatePortalVariables,
} from '../shared/types'
import type { getPortalAnalyticsFn } from '#/contexts/dashboard/server/portal-analytics'
import type { PortalTokenStatus } from '#/contexts/portal/application/public-api'

export const PORTAL_DETAIL_TABS = ['settings', 'links', 'share', 'analytics'] as const
export type PortalDetailTab = (typeof PORTAL_DETAIL_TABS)[number]

// getPortalAnalyticsFn authorizes on the `dashboard.read` permission, which maps
// to the `dashboard.use` capability (shared/auth/capability-for-permission.ts) —
// independent of `portal.read`. With portals enabled and the dashboard
// capability off, opening the tab rendered the raw policy-denial reason in
// destructive red, so the tab is not offered at all. The route gate and the
// server assert are unchanged; this only prevents a dead end.
const ANALYTICS_HIDDEN: ReadonlyArray<PortalDetailTab> = ['analytics']
const NONE_HIDDEN: ReadonlyArray<PortalDetailTab> = []

type Props = Readonly<{
  portal: Readonly<{
    id: string
    name: string
    slug: string
    description: string | null
    heroImageUrl: string | null
    theme: PortalThemeDraft
    propertyId: string
    organizationId: string
    publicationState: PortalPublicationState
  }>
  organizationName: string
  propertyId: string
  categories: readonly LinkTreeCategory[]
  activeTab: PortalDetailTab
  onTabChange: (tab: PortalDetailTab) => void
  links: readonly LinkTreeLink[]
  updateMutation: Action<UpdatePortalVariables>
  completeReviewMutation: Action<CompleteReviewVariables, CompleteReviewResult>
  issueTokenMutation: Action<
    { data: { portalId: string; printBatch?: string } },
    IssuedPortalLink
  >
  rotateTokenMutation: Action<{ data: { portalId: string } }, IssuedPortalLink>
  revokeTokenMutation: Action<{ data: { portalId: string; reason: string } }, unknown>
  /** C2: whether a public link is live. The raw URL is never part of this. */
  tokenStatus: PortalTokenStatus
  requestUploadUrl: (input: {
    data: { portalId: string; contentType: string; fileSize: number }
  }) => Promise<{ uploadUrl: string; key: string }>
  finalizeUpload: (input: {
    data: { portalId: string; key: string }
  }) => Promise<{ heroImageUrl: string }>
  getPortalAnalytics: typeof getPortalAnalyticsFn
}>

export function PortalDetailPage({
  portal,
  organizationName,
  propertyId,
  categories,
  links,
  activeTab,
  onTabChange,
  updateMutation,
  completeReviewMutation,
  issueTokenMutation,
  rotateTokenMutation,
  revokeTokenMutation,
  tokenStatus,
  requestUploadUrl,
  finalizeUpload,
  getPortalAnalytics,
}: Props) {
  const { previewOpen, setPreviewOpen } = usePreviewToggle(portal.id)
  const editFormRef = useRef<FormLike | null>(null)
  const [issuedPortalLink, setIssuedPortalLink] = useState<IssuedPortalLink | null>(null)
  const [linksRevoked, setLinksRevoked] = useState(false)
  const [theme, setTheme] = useState<PortalThemeDraft>(portal.theme)
  const { has } = useCapabilities()

  // Keyed on the colour values, not on `portal.theme`'s identity: the detail
  // query hands back a fresh theme object on every refetch, which would discard
  // an in-progress edit (and silently clear the unsaved-changes guard below).
  const { primaryColor, backgroundColor, textColor } = portal.theme
  useEffect(() => {
    setTheme({ primaryColor, backgroundColor, textColor })
  }, [primaryColor, backgroundColor, textColor])

  useEffect(() => {
    setIssuedPortalLink(null)
    setLinksRevoked(false)
  }, [portal.id])

  const analyticsAvailable = has('dashboard.use')
  // A `?tab=analytics` deep link must not resurrect the hidden tab.
  const tab = analyticsAvailable || activeTab !== 'analytics' ? activeTab : 'settings'
  const showPreview = tab === 'settings' || tab === 'links'

  const themeDirty =
    theme.primaryColor !== primaryColor ||
    theme.backgroundColor !== backgroundColor ||
    theme.textColor !== textColor
  // Mirrored into a ref so the navigation blocker gets a stable callback: a new
  // shouldBlockFn re-subscribes the history blocker on every colour keystroke.
  const themeDirtyRef = useRef(themeDirty)
  themeDirtyRef.current = themeDirty
  const hasUnsavedChanges = useCallback(
    () => themeDirtyRef.current || editFormRef.current?.hasUnsavedChanges() === true,
    [],
  )

  return (
    <div className="space-y-6">
      <PortalUnsavedChangesPrompt isDirty={hasUnsavedChanges} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" asChild>
          <Link to="/properties/$propertyId/portals" params={{ propertyId }}>
            <ArrowLeft /> Back
          </Link>
        </Button>
        {showPreview && (
          <Button
            variant="outline"
            className="min-h-11 sm:min-h-9"
            onClick={() => setPreviewOpen(!previewOpen)}
            aria-pressed={previewOpen}
          >
            <Eye /> {previewOpen ? 'Hide preview' : 'Preview'}
          </Button>
        )}
      </div>

      <PortalDetailTabs
        value={tab}
        onValueChange={onTabChange}
        hiddenTabs={analyticsAvailable ? NONE_HIDDEN : ANALYTICS_HIDDEN}
      >
        {tab === 'settings' && (
          <PortalSettings
            portal={portal}
            mutation={updateMutation}
            completeReviewMutation={completeReviewMutation}
            theme={theme}
            onThemeChange={setTheme}
            requestUploadUrl={requestUploadUrl}
            finalizeUpload={finalizeUpload}
            formRef={editFormRef}
          />
        )}

        {tab === 'links' && (
          <LinkTree portalId={portal.id} categories={categories} links={links} />
        )}

        {tab === 'share' && (
          <PortalShare
            portalId={portal.id}
            portalName={portal.name}
            issuedLink={issuedPortalLink}
            revoked={linksRevoked}
            tokenStatus={tokenStatus}
            onLinkIssued={(link) => {
              setIssuedPortalLink({ publicUrl: link.publicUrl })
              setLinksRevoked(false)
            }}
            onLinksRevoked={() => {
              setIssuedPortalLink(null)
              setLinksRevoked(true)
            }}
            issueMutation={issueTokenMutation}
            rotateMutation={rotateTokenMutation}
            revokeMutation={revokeTokenMutation}
          />
        )}

        {tab === 'analytics' && (
          <PortalAnalyticsTab
            portalId={portal.id}
            propertyId={propertyId}
            getPortalAnalytics={getPortalAnalytics}
          />
        )}
      </PortalDetailTabs>

      <PortalDetailPreview
        show={showPreview}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        portal={portal}
        organizationName={organizationName}
        theme={theme}
        categories={categories}
        links={links}
      />
    </div>
  )
}
