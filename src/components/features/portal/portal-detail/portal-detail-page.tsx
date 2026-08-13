// Portal detail page — tabbed layout controlled by typed route search state.

import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { ArrowLeft, Eye } from 'lucide-react'
import { PortalDetailTabs } from './portal-detail-tabs'
import { PortalSettings } from '../portal-settings/portal-settings'
import { LinkTree } from '../link-tree/link-tree'
import { PortalShare, type IssuedPortalLink } from '../portal-share/portal-share'
import { PortalAnalyticsTab } from '../portal-analytics/portal-analytics-tab'
import { usePreviewToggle } from '../portal-preview/use-preview-toggle'
import { PortalDetailPreview } from './portal-detail-preview'
import type { Action } from '#/components/hooks/use-action'
import type { LinkTreeCategory, LinkTreeLink } from '../link-tree/link-tree-types'
import type {
  FormLike,
  PortalPublicationState,
  UpdatePortalVariables,
} from '../shared/types'
import type { getPortalAnalyticsFn } from '#/contexts/dashboard/server/portal-analytics'

export const PORTAL_DETAIL_TABS = ['settings', 'links', 'share', 'analytics'] as const
export type PortalDetailTab = (typeof PORTAL_DETAIL_TABS)[number]

type Props = Readonly<{
  portal: Readonly<{
    id: string
    name: string
    slug: string
    description: string | null
    heroImageUrl: string | null
    theme: { primaryColor: string }
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
  issueTokenMutation: Action<
    { data: { portalId: string; printBatch?: string } },
    IssuedPortalLink
  >
  rotateTokenMutation: Action<{ data: { portalId: string } }, IssuedPortalLink>
  revokeTokenMutation: Action<{ data: { portalId: string; reason: string } }, unknown>
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
  issueTokenMutation,
  rotateTokenMutation,
  revokeTokenMutation,
  requestUploadUrl,
  finalizeUpload,
  getPortalAnalytics,
}: Props) {
  const { previewOpen, setPreviewOpen } = usePreviewToggle(portal.id)
  const editFormRef = useRef<FormLike | null>(null)
  const [issuedPortalLink, setIssuedPortalLink] = useState<IssuedPortalLink | null>(null)
  const [linksRevoked, setLinksRevoked] = useState(false)
  const [primaryColor, setPrimaryColor] = useState(portal.theme.primaryColor)

  useEffect(() => {
    setPrimaryColor(portal.theme.primaryColor)
  }, [portal.theme.primaryColor])

  useEffect(() => {
    setIssuedPortalLink(null)
    setLinksRevoked(false)
  }, [portal.id])
  const showPreview = activeTab === 'settings' || activeTab === 'links'
  return (
    <div className="space-y-6">
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

      <PortalDetailTabs value={activeTab} onValueChange={onTabChange}>
        {activeTab === 'settings' && (
          <PortalSettings
            portal={portal}
            mutation={updateMutation}
            primaryColor={primaryColor}
            onPrimaryColorChange={setPrimaryColor}
            requestUploadUrl={requestUploadUrl}
            finalizeUpload={finalizeUpload}
            formRef={editFormRef}
          />
        )}

        {activeTab === 'links' && (
          <LinkTree portalId={portal.id} categories={categories} links={links} />
        )}

        {activeTab === 'share' && (
          <PortalShare
            portalId={portal.id}
            portalName={portal.name}
            issuedLink={issuedPortalLink}
            revoked={linksRevoked}
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

        {activeTab === 'analytics' && (
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
        primaryColor={primaryColor}
        categories={categories}
        links={links}
      />
    </div>
  )
}
