// Portal context — pure state-derivation rules for the link tree.

import type { LinkTreeCategory, LinkTreeLink } from './link-tree-types'

/**
 * Which inline form produced the create/update error currently on screen.
 *
 * `useActionMutation` exposes no `reset()`, and one mutation object is shared by
 * every inline-form instance — so a failure while adding a link to category A
 * used to render under category B's empty inputs. Remembering the originating
 * form (and clearing it whenever a form opens, cancels or succeeds) scopes the
 * error to the instance that caused it.
 */
export type ErrorScope =
  'create-category' | 'create-link' | 'update-category' | 'update-link'

/**
 * An error reaches an inline form only while that form is the one that fired the
 * shared mutation; every other form reads `null`.
 *
 * Generic in the error type so the hook's returned `*Error` fields keep the
 * mutation's own error type rather than widening to `unknown`.
 */
export function scopedError<TError>(
  activeScope: ErrorScope | null,
  scope: ErrorScope,
  error: TError,
): TError | null {
  return activeScope === scope ? error : null
}

/**
 * The two inline-form slots a single category row can open, resolved together
 * because they are mutually positioned: the title form REPLACES the row, while
 * the link form renders UNDER whatever occupies that position.
 */
export type CategoryRowSlots = Readonly<{
  /** This category's own links, in the order they arrived. */
  links: readonly LinkTreeLink[]
  /** Render the title form instead of the sortable row. */
  isEditingTitle: boolean
  /** The link whose edit form belongs under this row, if any. */
  linkBeingEdited: LinkTreeLink | undefined
}>

/**
 * Resolves what a category row shows from the tree-wide editing state.
 *
 * Two boundaries live here. The editing ids are tree-wide, so a row must claim
 * `editingLink` only when the link is ITS OWN — otherwise every category
 * rendered the same edit form. And a viewer without `portal.update` gets
 * neither form: the ids can survive a permission change, and an open form is
 * an edit affordance.
 */
export function categoryRowSlots(
  category: LinkTreeCategory,
  links: readonly LinkTreeLink[],
  editing: Readonly<{
    editingCategory: string | null
    editingLink: string | null
    canEdit: boolean
  }>,
): CategoryRowSlots {
  const own = links.filter((link) => link.categoryId === category.id)
  if (!editing.canEdit)
    return { links: own, isEditingTitle: false, linkBeingEdited: undefined }

  return {
    links: own,
    isEditingTitle: editing.editingCategory === category.id,
    linkBeingEdited: own.find((link) => link.id === editing.editingLink),
  }
}
