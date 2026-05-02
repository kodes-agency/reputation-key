import { useState, useRef } from 'react'
import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { Switch } from '#/components/ui/switch'

// Minimal form type for ref that avoids TanStack Form's complex generic signature
type FormLike = {
  handleSubmit: () => void
}
import { Label } from '#/components/ui/label'
import { ArrowLeft, Eye } from 'lucide-react'
import { EditPortalForm } from './EditPortalForm'
import { ShareSection } from './ShareSection'
import { ThemePresetSelector } from './ThemePresetSelector'
import { SmartRoutingConfig } from './SmartRoutingConfig'
import { PortalPreviewPanel } from './PortalPreviewPanel'
import { usePreviewToggle } from './usePreviewToggle'
import {
  createLinkCategory,
  reorderCategories,
  deleteLinkCategory,
  createLink,
  deleteLink,
  updateLink,
  updateLinkCategory,
  reorderLinks,
} from '#/contexts/portal/server/portal-links'
import { SortableCategory } from './SortableCategory'
import { LinkAddInlineForm } from './LinkAddInlineForm'
import { LinkEditInlineForm } from './LinkEditInlineForm'
import { CategoryAddForm } from './CategoryAddForm'
import { CategoryEditInlineForm } from './CategoryEditInlineForm'
import { toast } from 'sonner'
import { generateKeyBetween } from 'fractional-indexing'
import {
  useMutationAction,
  useMutationActionSilent,
} from '#/components/hooks/use-mutation-action'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import type {
  PortalCategory,
  PortalLinkItem,
} from '#/components/guest/PublicPortalContent'
import type { Action } from '#/components/hooks/use-action'
import { usePermissions } from '#/shared/hooks/usePermissions'

type Category = { id: string; title: string; sortKey: string }
type LinkItem = {
  id: string
  label: string
  url: string
  sortKey: string
  categoryId: string
}

type PortalDetailPageProps = Readonly<{
  portal: {
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
  }
  organizationName: string
  propertySlug: string
  propertyId: string
  categories: Category[]
  links: LinkItem[]
  updateMutation: Action<{
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
  }>
}>

export function PortalDetailPage({
  portal,
  organizationName,
  propertySlug,
  propertyId,
  categories: initialCategories,
  links: initialLinks,
  updateMutation,
}: PortalDetailPageProps) {
  const { can } = usePermissions()
  const { previewOpen, setPreviewOpen } = usePreviewToggle(portal.id)
  const [isActive, setIsActive] = useState(portal.isActive)
  const editFormRef = useRef<FormLike | null>(null)

  // Link tree state
  const [categories, setCategories] = useState(initialCategories)
  const [links, setLinks] = useState(initialLinks)
  const [addingToCategory, setAddingToCategory] = useState<string | null>(null)
  const [editingLink, setEditingLink] = useState<string | null>(null)
  const [editingCategory, setEditingCategory] = useState<string | null>(null)
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null)
  const [deletingLinkId, setDeletingLinkIdState] = useState<string | null>(null)

  // Theme/routing state (optimistic preview)
  const [primaryColor, setPrimaryColor] = useState(portal.theme.primaryColor)
  const [smartRoutingEnabled, setSmartRoutingEnabled] = useState(
    portal.smartRoutingEnabled,
  )
  const [smartRoutingThreshold, setSmartRoutingThreshold] = useState(
    portal.smartRoutingThreshold,
  )

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const portalId = portal.id

  const createCategoryMutation = useMutationAction(createLinkCategory, {
    successMessage: 'Category created',
  })
  const createLinkMutation = useMutationAction(createLink, {
    successMessage: 'Link created',
  })
  const deleteCategoryMutation = useMutationActionSilent(deleteLinkCategory)
  const deleteLinkMutation = useMutationActionSilent(deleteLink)
  const reorderCategoriesMutation = useMutationActionSilent(reorderCategories)
  const reorderLinksMutation = useMutationActionSilent(reorderLinks)
  const updateLinkMutation = useMutationAction(updateLink, {
    successMessage: 'Link updated',
  })
  const updateCategoryMutation = useMutationAction(updateLinkCategory, {
    successMessage: 'Category updated',
  })

  const handleAddCategory = async (title: string) => {
    try {
      const result = await createCategoryMutation({ data: { portalId, title } })
      setCategories((prev) => [
        ...prev,
        {
          id: result.category.id,
          title: result.category.title,
          sortKey: result.category.sortKey,
        },
      ])
    } catch {
      toast.error('Failed to create category')
    }
  }

  const handleAddLink = async (categoryId: string, label: string, url: string) => {
    try {
      const result = await createLinkMutation({
        data: { categoryId, portalId, label, url },
      })
      setLinks((prev) => [
        ...prev,
        {
          id: result.link.id,
          label: result.link.label,
          url: result.link.url,
          sortKey: result.link.sortKey,
          categoryId,
        },
      ])
      setAddingToCategory(null)
    } catch {
      toast.error('Failed to create link')
    }
  }

  const handleDeleteCategory = async (catId: string) => {
    setDeletingCategoryId(catId)
    try {
      await deleteCategoryMutation({ data: { categoryId: catId } })
      setCategories((prev) => prev.filter((c) => c.id !== catId))
      setLinks((prev) => prev.filter((l) => l.categoryId !== catId))
    } catch {
      toast.error('Failed to delete category')
    } finally {
      setDeletingCategoryId(null)
    }
  }

  const handleDeleteLink = async (linkId: string) => {
    setDeletingLinkIdState(linkId)
    try {
      await deleteLinkMutation({ data: { linkId } })
      setLinks((prev) => prev.filter((l) => l.id !== linkId))
    } catch {
      toast.error('Failed to delete link')
    } finally {
      setDeletingLinkIdState(null)
    }
  }

  const handleUpdateLink = async (linkId: string, label: string, url: string) => {
    try {
      const result = await updateLinkMutation({ data: { linkId, label, url } })
      setLinks((prev) =>
        prev.map((l) =>
          l.id === linkId ? { ...l, label: result.link.label, url: result.link.url } : l,
        ),
      )
      setEditingLink(null)
    } catch {
      toast.error('Failed to update link')
    }
  }

  const handleUpdateCategory = async (catId: string, title: string) => {
    try {
      const result = await updateCategoryMutation({ data: { categoryId: catId, title } })
      setCategories((prev) =>
        prev.map((c) => (c.id === catId ? { ...c, title: result.category.title } : c)),
      )
      setEditingCategory(null)
    } catch {
      toast.error('Failed to update category')
    }
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = categories.findIndex((c) => c.id === active.id)
    const newIndex = categories.findIndex((c) => c.id === over.id)
    const reordered = arrayMove(categories, oldIndex, newIndex)
    setCategories(reordered)
    const updates: { id: string; sortKey: string }[] = []
    for (const cat of reordered) {
      const prev = updates.length > 0 ? updates[updates.length - 1].sortKey : null
      updates.push({ id: cat.id, sortKey: generateKeyBetween(prev, null) })
    }
    try {
      await reorderCategoriesMutation({ data: { portalId, items: updates } })
    } catch {
      toast.error('Failed to reorder categories')
    }
  }

  const handleReorderLinks = async (categoryId: string, reordered: LinkItem[]) => {
    const otherLinks = links.filter((l) => l.categoryId !== categoryId)
    const updates: { id: string; sortKey: string }[] = []
    for (const link of reordered) {
      const prev = updates.length > 0 ? updates[updates.length - 1].sortKey : null
      updates.push({ id: link.id, sortKey: generateKeyBetween(prev, null) })
    }
    setLinks([
      ...otherLinks,
      ...reordered.map((l, i) => ({ ...l, sortKey: updates[i].sortKey })),
    ])
    try {
      await reorderLinksMutation({ data: { portalId, categoryId, items: updates } })
    } catch {
      toast.error('Failed to reorder links')
    }
  }

  // Build optimistic preview data
  const previewPortal = {
    id: portal.id,
    name: portal.name,
    description: portal.description,
    organizationName,
    heroImageUrl: portal.heroImageUrl,
    theme: {
      primaryColor,
    } as Record<string, string>,
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" asChild>
            <Link to="/properties/$propertyId/portals" params={{ propertyId }}>
              <ArrowLeft />
              Back
            </Link>
          </Button>
        </div>
        <Button variant="outline" size="sm" onClick={() => setPreviewOpen(!previewOpen)}>
          <Eye className="size-3.5 mr-1" />
          {previewOpen ? 'Hide Preview' : 'Preview'}
        </Button>
      </div>

      {/* Settings Section */}
      <section className="rounded-lg border p-4 space-y-4">
        <h2 className="text-lg font-semibold">Settings</h2>

        {/* Active/Inactive toggle */}
        <div className="flex items-center justify-between rounded-md border px-4 py-3">
          <div className="space-y-0.5">
            <Label htmlFor="portal-active" className="text-sm font-medium">
              Portal Active
            </Label>
            <p className="text-xs text-muted-foreground">
              {isActive
                ? 'Guests can access this portal.'
                : 'Guests will see an "unavailable" message.'}
            </p>
          </div>
          <Switch
            id="portal-active"
            checked={isActive}
            onCheckedChange={(checked) => {
              setIsActive(checked)
              updateMutation({ data: { portalId: portal.id, isActive: checked } })
            }}
            disabled={!can('portal.update') || updateMutation.isPending}
          />
        </div>

        <EditPortalForm
          portal={{
            ...portal,
            theme: { primaryColor },
            smartRoutingEnabled,
            smartRoutingThreshold,
          }}
          mutation={updateMutation}
          formRef={editFormRef}
        />

        {/* Theme Presets */}
        <div className="space-y-2">
          <h3 className="font-semibold">Theme</h3>
          <ThemePresetSelector
            primaryColor={primaryColor}
            onPrimaryColorChange={setPrimaryColor}
            disabled={!can('portal.update')}
          />
        </div>

        {/* Smart Routing */}
        <div className="space-y-2">
          <h3 className="font-semibold">Smart Routing</h3>
          <SmartRoutingConfig
            enabled={smartRoutingEnabled}
            onEnabledChange={setSmartRoutingEnabled}
            threshold={smartRoutingThreshold}
            onThresholdChange={setSmartRoutingThreshold}
            disabled={!can('portal.update')}
          />
        </div>

        {can('portal.update') && (
          <Button onClick={() => editFormRef.current?.handleSubmit()}>
            {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        )}
      </section>

      {/* Link Tree Section */}
      <section className="rounded-lg border p-4 space-y-4">
        <h2 className="text-lg font-semibold">Link Tree</h2>

        {can('portal.update') && (
          <CategoryAddForm
            onSubmit={handleAddCategory}
            isPending={createCategoryMutation.isPending}
            error={createCategoryMutation.error}
          />
        )}

        {addingToCategory && can('portal.update') && (
          <LinkAddInlineForm
            onSubmit={(label, url) => handleAddLink(addingToCategory, label, url)}
            onCancel={() => setAddingToCategory(null)}
            isPending={createLinkMutation.isPending}
            error={createLinkMutation.error}
          />
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={categories.map((c) => c.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col gap-4">
              {categories.map((cat) => (
                <div key={cat.id}>
                  {editingCategory === cat.id && can('portal.update') ? (
                    <CategoryEditInlineForm
                      initialTitle={cat.title}
                      onSubmit={(title) => handleUpdateCategory(cat.id, title)}
                      onCancel={() => setEditingCategory(null)}
                      isPending={updateCategoryMutation.isPending}
                      error={updateCategoryMutation.error}
                    />
                  ) : (
                    <SortableCategory
                      category={cat}
                      links={links.filter((l) => l.categoryId === cat.id)}
                      isDeletingCategory={deletingCategoryId === cat.id}
                      deletingLinkId={deletingLinkId ?? undefined}
                      onAddLink={(catId) => {
                        setAddingToCategory(catId)
                        setEditingLink(null)
                        setEditingCategory(null)
                      }}
                      onDeleteLink={handleDeleteLink}
                      onDeleteCategory={handleDeleteCategory}
                      onEditCategory={(c) => setEditingCategory(c.id)}
                      onEditLink={(link) => {
                        setEditingLink(link.id)
                        setAddingToCategory(null)
                        setEditingCategory(null)
                      }}
                      onReorderLinks={handleReorderLinks}
                      canEdit={can('portal.update')}
                    />
                  )}
                  {editingLink &&
                    links
                      .filter((l) => l.categoryId === cat.id)
                      .map((link) =>
                        link.id === editingLink && can('portal.update') ? (
                          <LinkEditInlineForm
                            key={link.id}
                            initialLabel={link.label}
                            initialUrl={link.url}
                            onSubmit={(label, url) =>
                              handleUpdateLink(link.id, label, url)
                            }
                            onCancel={() => setEditingLink(null)}
                            isPending={updateLinkMutation.isPending}
                            error={updateLinkMutation.error}
                          />
                        ) : null,
                      )}
                </div>
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {categories.length === 0 && (
          <div className="py-8 text-center">
            <p className="text-muted-foreground">
              No categories yet. Create one to start organizing links.
            </p>
          </div>
        )}
      </section>

      {/* Share Section */}
      <ShareSection portalSlug={portal.slug} propertySlug={propertySlug} />

      {/* Slide-over Preview */}
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
