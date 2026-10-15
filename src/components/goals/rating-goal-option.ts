// The radio cards of "Pick a plan": the plans, and the options of each row of
// "Build your own". Each card is pressed anywhere on it, not only on its radio:
// the label is stretched over the whole card, and the card is at least a tap
// target tall below `md`. The checked one wears the primary edge and tint.

/** A radio card. */
export const OPTION =
  'relative flex min-h-(--control-touch) items-start gap-3 rounded-lg border p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5'

/** The card's label, stretched over the whole card so any of it picks the option. */
export const OPTION_LABEL =
  'cursor-pointer font-normal after:absolute after:inset-0 after:rounded-lg'

/** Quiet words beside a figure. */
export const QUIET = 'text-sm text-muted-foreground'
