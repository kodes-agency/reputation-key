// Inline import setup has no dialog to cancel, so Not now is recorded by its owner as a
// decided setup step.

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
