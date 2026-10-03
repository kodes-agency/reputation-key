import type { ReactNode } from 'react'

import { Button, type ButtonProps } from '#/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip'

/** How long a pointer rests on an icon before its name appears (a keyboard focus is immediate). */
const TOOLTIP_DELAY_MS = 400

type IconButtonProps = Omit<ButtonProps, 'aria-label' | 'children' | 'size'> & {
  /** What the button does, as a verb phrase: "Refresh", "More actions for Anna". The accessible name. */
  label: string
  /** A square Button size; the density rules of Button apply. */
  size?: 'icon' | 'icon-sm' | 'icon-xs' | 'icon-lg'
  /**
   * What a pointer or a keyboard user reads on hover or focus. `true` (the default)
   * shows the label; a string shows that instead (the label and a shortcut);
   * `false` shows none. A button that opens a menu, popover or sheet
   * (`aria-haspopup`, which Radix's triggers add) shows none either: the open
   * popup says what it is, and when it closes Radix returns focus to the button,
   * which would open the tooltip unprompted. Needs a `TooltipProvider` above it: the authenticated shell mounts the app's
   * (`SidebarProvider`), and a story gets the preview's. Outside the shell, pass
   * `false`.
   */
  tooltip?: boolean | string
  /** The glyph. */
  children: ReactNode
}

const opensPopup = (haspopup: ButtonProps['aria-haspopup']) =>
  haspopup !== undefined && haspopup !== false && haspopup !== 'false'

/**
 * A Button with no words: the glyph, a required name and a tooltip that repeats
 * it. Every icon-only control goes through this, so the name, the hint and the
 * touch height are not re-derived at each call site.
 */
function IconButton({
  label,
  size = 'icon',
  variant = 'ghost',
  tooltip = true,
  asChild,
  type,
  ...props
}: IconButtonProps) {
  const button = (
    <Button
      // Stated on the Button element itself so the tooltip's trigger does not
      // replace it: the link layer in styles.css keys on `button` to leave a link
      // drawn as a Button its own ink. A caller's `data-slot` (a menu trigger's, the
      // sidebar's) still wins, as it does on a plain Button.
      data-slot="button"
      {...props}
      // A square button has no label to keep: pending, the spinner takes the glyph's place.
      pendingLabel=""
      asChild={asChild}
      variant={variant}
      size={size}
      type={asChild ? type : (type ?? 'button')}
      aria-label={label}
    />
  )
  if (tooltip === false || opensPopup(props['aria-haspopup'])) return button

  return (
    <Tooltip delayDuration={TOOLTIP_DELAY_MS}>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{tooltip === true ? label : tooltip}</TooltipContent>
    </Tooltip>
  )
}

export { IconButton }
export type { IconButtonProps }
