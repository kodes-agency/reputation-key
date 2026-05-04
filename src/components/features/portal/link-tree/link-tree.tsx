// Link tree — full CRUD for categories and links with DnD support.
// Extracted from portal-detail-page to separate the link-tree concern.

import { useState } from 'react'
import { toast } from 'sonner'
import { generateKeyBetween } from 'fractional-indexing'
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
import {
  useMutationAction,
  useMutationActionSilent,
} from '#/components/hooks/use-mutation-action'
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
import { SortableCategory } from './sortable-category'
import { LinkAddInlineForm } from './link-add-inline-form'
import { LinkEditInlineForm } from './link-edit-inline-form'
import { CategoryAddForm } from './category-add-form'
import { CategoryEditInlineForm } from './category-edit-inline-form'
import { usePermissions } from '#/shared/hooks/usePermissions'

type Category = { id: string; title: string; sortKey: string }
type LinkItem = {
  id: string
  label: string
  url: string
  sortKey: string
  categoryId: string
}

type Props = Readonly<{
  portalId: string
  categories: Category[]
  links: LinkItem[]
}>

export function LinkTree({
  portalId,
  categories: initialCategories,
  links: initialLinks,
}: Props) {
  const { can } = usePermissions()
  const [categories, setCategories] = useState(initialCategories)
  const [links, setLinks] = useState(initialLinks)
  const [addingToCategory, setAddingToCategory] = useState<string | null>(null)
  const [editingLink, setEditingLink] = useState<string | null>(null)
  const [editingCategory, setEditingCategory] = useState<string | null>(null)
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null)
  const [deletingLinkId, setDeletingLinkIdState] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

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

  return (
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
                          onSubmit={(label, url) => handleUpdateLink(link.id, label, url)}
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
  )
}
