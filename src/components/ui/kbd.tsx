import * as React from 'react'

import { cn } from '#/lib/utils'

/**
 * A keyboard key, printed — shadcn's `kbd`, as the registry ships it (plan
 * v2.1 row 21).
 *
 * Presentation only. It renders a real `<kbd>` so the markup says what the
 * glyph is, but it binds nothing: a caller that prints a shortcut beside a
 * control owns both the binding and the decision to hide the hint from
 * assistive technology (the composer's segment passes `aria-hidden`, because
 * the tab's accessible name is pinned by e2e and the key is not part of it).
 *
 * `text-muted-foreground` on `bg-muted` is the pairing the composer measured
 * for the segment's resting label (5.87:1 light, 6.49:1 dark). Its one caller
 * re-fills the cap with `bg-background` to match the canvas's outlined key;
 * read back from the rendered key in Chromium and WebKit that is 6.19:1 light
 * and 7.53:1 dark (`composer-mode-row.tsx`).
 *
 * The registry's `KbdGroup` is not brought in: one key per hint is all the
 * only consumer prints, and a chord can be added with its first caller.
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
