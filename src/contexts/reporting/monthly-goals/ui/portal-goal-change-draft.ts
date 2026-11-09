// The draft of a change sheet: it opens once and is edited by reducing one edit at a time.
// The count sheet and the average sheet share it; each brings its own opening and reducer.

import { useState } from 'react'
import type { PortalGoalChangeSubmission } from './portal-goal-change-submission'

/** What a change sheet sends once the manager presses its primary. */
export type PortalGoalChangeSend = Readonly<{
  submission: PortalGoalChangeSubmission
  toast: string
}>

export function usePortalGoalChangeDraft<Draft, Edit>(
  opening: () => Draft,
  changed: (draft: Draft, edit: Edit) => Draft,
) {
  const [draft, setDraft] = useState(opening)
  const edit = (next: Edit) => setDraft((current) => changed(current, next))
  return { draft, edit }
}

/** Nothing is sent until the sheet has both a submission and the words said after it. */
export function portalGoalChangeSend(
  model: Readonly<{
    submission: PortalGoalChangeSubmission | null
    toast: string | null
  }>,
): PortalGoalChangeSend | null {
  if (model.submission === null || model.toast === null) return null
  return { submission: model.submission, toast: model.toast }
}
