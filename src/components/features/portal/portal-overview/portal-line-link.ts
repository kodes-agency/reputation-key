// The look of a control in a Portal's one quiet line (its issues, "Continue
// setup", "Review & publish", the older code): 12 px type, in the text's own
// ink, and a tap target on a phone. The height is the Button's own `touch` option
// (`--control-touch` below `md`), so it is a minimum that a desktop table row never
// feels. A link wears these through `buttonVariants`; the ink is a utility, which
// beats the link layer's accent default.
import { buttonVariants } from '#/components/ui/button'
import { ROW_FIGURE_LINK } from '#/components/ui/row-link'
import { cn } from '#/lib/utils'

/** Wraps rather than runs on, so a long line stays inside a card. */
export const PORTAL_LINE_LINK = cn(
  'justify-start gap-1.5 text-left text-xs whitespace-normal',
  ROW_FIGURE_LINK,
)

/** A link on its own: the Button's link variant at the line's height. */
export const portalLineLinkClass = (className?: string): string =>
  cn(
    buttonVariants({ variant: 'link', size: 'inline', touch: true }),
    PORTAL_LINE_LINK,
    'font-medium',
    className,
  )

/** The ink of a line that says something is wrong: red when guests cannot use the Portal, amber when not. */
export const PORTAL_LINE_TONE = {
  blocking: 'text-negative',
  notice: 'text-warn',
} as const
