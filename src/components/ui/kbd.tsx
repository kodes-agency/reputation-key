import * as React from 'react'

import { cn } from '#/lib/utils'

/**
 * A keyboard key, printed. Presentation only: it renders a real `<kbd>` but binds
 * nothing; a caller that prints a shortcut owns both the binding and the decision to
 * hide the hint from assistive technology. `text-muted-foreground` on `bg-muted`
 * is the pairing measured for the composer segment's resting label (5.87:1 light,
 * 6.49:1 dark).
 */
function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm bg-muted px-1 font-sans text-xs font-medium text-muted-foreground select-none',
        "[&_svg:not([class*='size-'])]:size-3",
        '[[data-slot=tooltip-content]_&]:bg-background/20 [[data-slot=tooltip-content]_&]:text-background dark:[[data-slot=tooltip-content]_&]:bg-background/10',
        className,
      )}
      {...props}
    />
  )
}

export { Kbd }
