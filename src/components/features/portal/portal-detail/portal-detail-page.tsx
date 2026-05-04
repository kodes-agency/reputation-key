// Portal detail page — thin orchestrator that composes settings, link-tree, share, and preview.

import { useState, useRef } from 'react'
import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { ArrowLeft, Eye } from 'lucide-react'
import { PortalSettings } from '../portal-settings/portal-settings'
import { LinkTree } from '../link-tree/link-tree'
import { PortalShare } from '../portal-share/portal-share'
import { PortalPreviewPanel } from '../portal-preview/portal-preview-panel'
import { usePreviewToggle } from '../portal-preview/use-preview-toggle'
import type { Action } from '#/components/hooks/use-action'
import type { PortalCategory, PortalLinkItem } from '#/components/features/guest'

type Category = { id: string; title: string; sortKey: string }
type LinkItem = {
  id: string
  label: string
  url: string
  sortKey: string
  categoryId: string
}
type FormLike = { handleSubmit: () => void }
type UpdatePortalVariables = {
  data: {
    portalId: string
    name?: string
    slug?: string
    description?: string | null
    theme?: { primaryColor: string }
    smartRoutingEnabled?: boolean
    smartRoutingThreshold?: number
    isActive?: boolean
  }
}

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
  categories: Category[]
  links: LinkItem[]
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
        <Button variant="outline" size="sm" onClick={() => setPreviewOpen(!previewOpen)}>
          <Eye className="size-3.5 mr-1" /> {previewOpen ? 'Hide Preview' : 'Preview'}
        </Button>
      </div>

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

      <LinkTree portalId={portal.id} categories={categories} links={links} />
      <PortalShare portalSlug={portal.slug} propertySlug={propertySlug} />
      <PortalPreviewPanel
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        portal={previewPortal}
        categories={previewCategories}
        links={previewLinks}
      />
    </div>
  )
}
