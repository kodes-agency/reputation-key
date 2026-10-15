// The way out of a step of the Google rating goal wizard. In a dialog it is
// Cancel (or the step's own word, such as Close); inside the Google import's
// setup frame there is nothing to cancel back to, so it is "Not now", which
// the frame's owner records (the setup checklist then counts the step as
// decided). One component, so no step spells which.
import { createContext, use, type ReactNode } from 'react'
import { DialogCancel } from '#/components/ui/dialog'

const InlineCancelLabel = createContext<string | null>(null)

/** Set by the inline frame: every step's way out reads this word instead. */
export const RatingGoalInlineCancelLabel = InlineCancelLabel.Provider

export function RatingGoalCancel({ children }: Readonly<{ children?: ReactNode }>) {
  const inline = use(InlineCancelLabel)
  return <DialogCancel>{inline ?? children ?? 'Cancel'}</DialogCancel>
}

/**
 * The way out of a step that has none in a dialog (its Escape and close do
 * it): inside the setup frame there is neither, so the step offers "Not now"
 * like every other. Nothing in a dialog.
 */
export function RatingGoalInlineCancel() {
  const inline = use(InlineCancelLabel)
  return inline === null ? null : <DialogCancel>{inline}</DialogCancel>
}
