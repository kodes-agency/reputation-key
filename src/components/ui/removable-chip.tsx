import type * as React from 'react'
import { X } from 'lucide-react'

import { cn } from '#/lib/utils'

type Props = Omit<
  React.ComponentProps<'button'>,
  'aria-label' | 'children' | 'onClick' | 'type'
> &
  Readonly<{
    /** What the chip says: the filter, the property. */
    label: string
    /** What pressing it does, as its name: "Remove filter: Reviews", "Remove The Harbor". */
    removeLabel: string
    onRemove: (event: React.MouseEvent<HTMLButtonElement>) => void
  }>

/**
 * A choice made, shown as a pill you press to take back (UI consistency scan:
 * COLL-22). The Inbox's active-filter row drew these as raw buttons and the member
 * invitation's assigned properties as a Badge with a second button inside it: two
 * anatomies, and the second a small target in a pill that is not one. The whole
 * chip is the button, with the X as its cue.
 *
 * It is 32px on purpose, a chip and not a control: a row of them (the Inbox's on
 * a phone) is a strip of 44px with a 32px chip in it. A mutually exclusive choice
 * (the Inbox sheet's radio pills) is a different thing and keeps its own anatomy.
 */
export function RemovableChip({
  label,
  removeLabel,
  onRemove,
  className,
  ...props
}: Props) {
  return (
    <button
      type="button"
      data-slot="removable-chip"
      aria-label={removeLabel}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1 rounded-full border bg-background pr-2 pl-3 text-xs font-medium transition-colors hover:bg-muted focus-ring',
        className,
      )}
      onClick={onRemove}
      {...props}
    >
      {label}
      <X aria-hidden="true" className="size-3.5" />
    </button>
  )
}
