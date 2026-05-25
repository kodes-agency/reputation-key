import type { PortalCategory, PortalLinkItem } from '#/components/features/guest'
import type { LinkTreeCategory, LinkTreeLink } from '../link-tree/link-tree-types'
import { PortalPreviewPanel } from '../portal-preview/portal-preview-panel'

type Props = Readonly<{
  show: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  portal: Readonly<{
    id: string
    name: string
    description: string | null
    heroImageUrl: string | null
  }>
  organizationName: string
  primaryColor: string
  categories: readonly LinkTreeCategory[]
  links: readonly LinkTreeLink[]
}>

export function PortalDetailPreview({
  show,
  open,
  onOpenChange,
  portal,
  organizationName,
  primaryColor,
  categories,
  links,
}: Props) {
  if (!show) return null

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
    <PortalPreviewPanel
      open={open}
      onOpenChange={onOpenChange}
      portal={previewPortal}
      categories={previewCategories}
      links={previewLinks}
    />
  )
}
