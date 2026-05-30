// Portal detail page — tabbed layout: Settings, Links, Share, Analytics
// Tab state via search params (?tab=settings|links|share|analytics)

import { useState, useRef } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { ArrowLeft, Eye } from 'lucide-react'
import { PortalSettings } from '../portal-settings/portal-settings'
import { LinkTree } from '../link-tree/link-tree'
import { PortalShare } from '../portal-share/portal-share'
import { PortalAnalyticsTab } from '../portal-analytics/portal-analytics-tab'
import { getPortalAnalyticsFn } from '#/contexts/dashboard/server/portal-analytics'
import { usePreviewToggle } from '../portal-preview/use-preview-toggle'
import { PortalDetailPreview } from './portal-detail-preview'
import { PortalDetailTabBar, type TabName } from './portal-detail-tab-bar'
import type { Action } from '#/components/hooks/use-action'
import type { LinkTreeCategory, LinkTreeLink } from '../link-tree/link-tree-types'
import type { FormLike, UpdatePortalVariables } from '../shared/types'

const VALID_TABS = ['settings', 'links', 'share', 'analytics'] as const

type Props = Readonly<{
  portal: Readonly<{
    id: string
    name: string
    slug: string
    description: string | null
    heroImageUrl: string | null
    theme: { primaryColor: string }
    smartRoutingEnabled: boolean
    smartRoutingThreshold: number
    organizationId: string
    isActive: boolean
  }>
  organizationName: string
  propertySlug: string
  propertyId: string
  categories: readonly LinkTreeCategory[]
  links: readonly LinkTreeLink[]
  updateMutation: Action<UpdatePortalVariables>
  requestUploadUrl: (input: {
    data: { portalId: string; contentType: string; fileSize: number }
  }) => Promise<{ uploadUrl: string; key: string }>
  finalizeUpload: (input: {
    data: { portalId: string; key: string }
  }) => Promise<{ heroImageUrl: string }>
}>

export function PortalDetailPage({
  portal,
  organizationName,
  propertyId,
  categories,
  links,
  updateMutation,
  requestUploadUrl,
  finalizeUpload,
}: Props) {
  const { previewOpen, setPreviewOpen } = usePreviewToggle(portal.id)
  const [isActive, setIsActive] = useState(portal.isActive)
  const editFormRef = useRef<FormLike | null>(null)
  const [primaryColor, setPrimaryColor] = useState(portal.theme.primaryColor)
  const [smartRoutingEnabled, setSmartRoutingEnabled] = useState(
    portal.smartRoutingEnabled,
  )
  const [smartRoutingThreshold, setSmartRoutingThreshold] = useState(
    portal.smartRoutingThreshold,
  )

  const router = useRouter()
  const currentTab: TabName = (() => {
    const params = new URLSearchParams(
      typeof window !== 'undefined' ? window.location.search : '',
    )
    const t = params.get('tab')
    return VALID_TABS.includes(t as TabName) ? (t as TabName) : 'settings'
  })()

  const handleTabChange = (value: string) => {
    const url = new URL(window.location.href)
    url.searchParams.set('tab', value)
    router.navigate({ to: url.pathname + url.search, replace: true })
  }

  const showPreview = currentTab === 'settings' || currentTab === 'links'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" asChild>
          <Link to="/properties/$propertyId/portals" params={{ propertyId }}>
            <ArrowLeft /> Back
          </Link>
        </Button>
        {showPreview && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPreviewOpen(!previewOpen)}
          >
            <Eye className="size-3.5 mr-1" /> {previewOpen ? 'Hide Preview' : 'Preview'}
          </Button>
        )}
      </div>

      <PortalDetailTabBar currentTab={currentTab} onChange={handleTabChange} />

      {currentTab === 'settings' && (
        <PortalSettings
          portal={portal}
          mutation={updateMutation}
          primaryColor={primaryColor}
          onPrimaryColorChange={setPrimaryColor}
          smartRoutingEnabled={smartRoutingEnabled}
          onSmartRoutingEnabledChange={setSmartRoutingEnabled}
          smartRoutingThreshold={smartRoutingThreshold}
          onSmartRoutingThresholdChange={setSmartRoutingThreshold}
          isActive={isActive}
          onIsActiveChange={setIsActive}
          requestUploadUrl={requestUploadUrl}
          finalizeUpload={finalizeUpload}
          formRef={editFormRef}
        />
      )}

      {currentTab === 'links' && (
        <LinkTree portalId={portal.id} categories={categories} links={links} />
      )}

      {currentTab === 'share' && (
        <PortalShare portalSlug={portal.slug} propertySlug={portal.slug} />
      )}

      {currentTab === 'analytics' && (
        <PortalAnalyticsTab portalId={portal.id} propertyId={propertyId} getPortalAnalyticsFn={getPortalAnalyticsFn} />
      )}

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
