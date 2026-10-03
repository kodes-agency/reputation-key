// The segmented pill's look, apart from the radio group that carries it, so a
// menu can draw an inline choice the same way (`dropdown-menu.tsx`) without
// importing the radio group.

/**
 * A 26 px segment inside a 2 px inset in a muted pill. The chosen segment is
 * the boards' white chip: `bg-card` with a 1 px `--border-control` ring (3:1 on
 * the pill, WCAG 1.4.11) and a soft drop, so it reads as chosen without leaning
 * on text weight or hue. In the dark theme the fill follows `tabs.tsx`
 * (`bg-input/30`) and the ring carries the shape.
 */
const CHOSEN_EDGE =
  'data-[state=checked]:shadow-[0_0_0_1px_var(--border-control),0_1px_2px_rgb(0_0_0/0.1)]'
export const SEGMENT_CLASS =
  'inline-flex h-[26px] items-center justify-center rounded-sm px-2.5 text-[13px] leading-5 whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-card data-[state=checked]:font-medium data-[state=checked]:text-foreground dark:data-[state=checked]:bg-input/30 ' +
  CHOSEN_EDGE

/** The pill that holds the segments. */
export const SEGMENTED_CONTROL_CLASS =
  'inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5'
