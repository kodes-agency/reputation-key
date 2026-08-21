import type { PortalCategory, PortalLinkItem } from '#/components/features/guest'
import type { LinkTreeCategory, LinkTreeLink } from '../link-tree/link-tree-types'
import type { PortalThemeDraft } from '../shared/types'
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
  /** The unsaved draft, so the preview reflects every colour being edited. */
  theme: PortalThemeDraft
  categories: readonly LinkTreeCategory[]
  links: readonly LinkTreeLink[]
}>

export function PortalDetailPreview({
  show,
  open,
  onOpenChange,
  portal,
  organizationName,
  theme,
  categories,
  links,
}: Props) {
  if (!show) return null

  // PublicPortalContent narrows each colour out of an open JSON record, so the
  // draft's optional colours are omitted rather than sent as undefined — that
  // way an unset colour falls back to the guest page default instead of
  // overriding it with a blank.
  const previewTheme: Record<string, string> = { primaryColor: theme.primaryColor }
  if (theme.backgroundColor !== undefined)
    previewTheme.backgroundColor = theme.backgroundColor
  if (theme.textColor !== undefined) previewTheme.textColor = theme.textColor

  const previewPortal = {
    id: portal.id,
    name: portal.name,
    description: portal.description,
    organizationName,
    heroImageUrl: portal.heroImageUrl,
    theme: previewTheme,
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
