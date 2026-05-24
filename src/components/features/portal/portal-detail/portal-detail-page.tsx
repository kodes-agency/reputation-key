// Portal detail page — tabbed layout: Settings, Links, Share, Analytics
// Tab state via search params (?tab=settings|links|share|analytics)
// Preview panel shown only on Settings + Links tabs

import { useState, useRef } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { ArrowLeft, Eye, Settings, Link2, Share2, BarChart3 } from 'lucide-react'
import { PortalSettings } from '../portal-settings/portal-settings'
import { LinkTree } from '../link-tree/link-tree'
import { PortalShare } from '../portal-share/portal-share'
import { PortalAnalyticsTab } from '../portal-analytics/portal-analytics-tab'
import { PortalPreviewPanel } from '../portal-preview/portal-preview-panel'
import { usePreviewToggle } from '../portal-preview/use-preview-toggle'
import type { Action } from '#/components/hooks/use-action'
import type { PortalCategory, PortalLinkItem } from '#/components/features/guest'
import type { LinkTreeCategory, LinkTreeLink } from '../link-tree/link-tree-types'
import type { FormLike, UpdatePortalVariables } from '../shared/types'

const VALID_TABS = ['settings', 'links', 'share', 'analytics'] as const
type TabName = (typeof VALID_TABS)[number]

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
  propertySlug,
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

  // Tab state from search params (untyped — route doesn't define search schema)
  const router = useRouter()
  const currentTab: TabName = (() => {
    const params = new URLSearchParams(
      typeof window !== 'undefined' ? window.location.search : ''
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

  const previewPortal = {
    id: portal.id,
    name: portal.name,
    description: portal.description,
    organizationName,
    heroImageUrl: portal.heroImageUrl,
    theme: { primaryColor },
  }
  const previewCategories: PortalCategory[] = categories.map((c) => ({
    id: c.id,
    title: c.title,
  }))
  const previewLinks: PortalLinkItem[] = links.map((l) => ({
    id: l.id,
    label: l.label,
    url: l.url,
    categoryId: l.categoryId,
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" asChild>
          <Link to="/properties/$propertyId/portals" params={{ propertyId }}>
            <ArrowLeft /> Back
          </Link>
        </Button>
        {showPreview && (
          <Button variant="outline" size="sm" onClick={() => setPreviewOpen(!previewOpen)}>
            <Eye className="size-3.5 mr-1" /> {previewOpen ? 'Hide Preview' : 'Preview'}
          </Button>
        )}
      </div>

      <Tabs value={currentTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="settings" className="gap-1.5">
            <Settings className="size-3.5" /> Settings
          </TabsTrigger>
          <TabsTrigger value="links" className="gap-1.5">
            <Link2 className="size-3.5" /> Links
          </TabsTrigger>
          <TabsTrigger value="share" className="gap-1.5">
            <Share2 className="size-3.5" /> Share
          </TabsTrigger>
          <TabsTrigger value="analytics" className="gap-1.5">
            <BarChart3 className="size-3.5" /> Analytics
          </TabsTrigger>
        </TabsList>
      </Tabs>

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
        <PortalShare portalSlug={portal.slug} propertySlug={propertySlug} />
      )}

      {currentTab === 'analytics' && (
        <PortalAnalyticsTab portalId={portal.id} propertyId={propertyId} />
      )}

      {showPreview && (
        <PortalPreviewPanel
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          portal={previewPortal}
          categories={previewCategories}
          links={previewLinks}
        />
      )}
    </div>
  )
}
