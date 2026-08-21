// Empty state for link tree when no categories exist.
// Uses the shared EmptyState (icon + title + CTA) so the Links tab reads like
// portal-list-page.tsx and portal-group-management.tsx rather than a stray <p>.

import { ListTree, Plus } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'

type Props = Readonly<{
  /** Focuses the category name input. Omitted when the viewer cannot edit. */
  onAddCategory?: () => void
}>

export function LinkTreeEmptyState({ onAddCategory }: Props) {
  return (
    <EmptyState icon={ListTree} title="No categories yet">
      <p className="text-sm text-muted-foreground">
        Categories group the links your guests see. Start with one, such as “Review
        sites”.
      </p>
      {onAddCategory && (
        <Button className="min-h-11 sm:min-h-9" onClick={onAddCategory}>
          <Plus />
          Add your first category
        </Button>
      )}
    </EmptyState>
  )
}
