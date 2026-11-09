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
 * A choice made, shown as a pill you press to take back. The whole chip is the
 * button, with the X as its cue. It is 32px tall from `md`, and below it a tap
 * target: `--control-touch` is the minimum (44px, 36px in a compact workspace). A
 * mutually exclusive choice (radio pills) is a different thing and keeps its own
 * anatomy.
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
        'inline-flex h-8 shrink-0 items-center gap-1 rounded-full border bg-background pr-2 pl-3 text-xs font-medium transition-colors hover:bg-muted focus-ring max-md:min-h-(--control-touch)',
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
