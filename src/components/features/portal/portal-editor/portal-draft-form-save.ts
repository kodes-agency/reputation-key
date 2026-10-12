// One TanStack Form as one autosave write.
//
// `handleSubmit` resolves whether or not the values passed the form's schema,
// and it calls the server even when nothing changed since the last write. The
// adapter adds the three things autosave needs on top of it: skip a write when
// the values equal what the server already holds, tell "invalid" apart from
// "saved", and remember what was written so the next comparison is honest.

import type { PortalDraftSaveOutcome } from './portal-draft-autosave'

/** The slice of a TanStack Form the adapter touches. */
export type DraftFormApi = Readonly<{
  handleSubmit: () => Promise<void>
  state: Readonly<{ values: unknown; isValid: boolean }>
}>

/**
 * What the server is known to hold for one form, as a stable string, or `null`
 * when that is not known (a write failed, and a failed request may still have
 * landed).
 */
export type DraftFormSaveTracker = { saved: string | null }

/** Key order must not make equal values look different. */
function stableSerialize(value: unknown): string {
  return JSON.stringify(value, (_key, nested: unknown) =>
    nested !== null && typeof nested === 'object' && !Array.isArray(nested)
      ? Object.fromEntries(
          Object.entries(nested as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : nested,
  )
}

export function createDraftFormSaveTracker(initialValues: unknown): DraftFormSaveTracker {
  return { saved: stableSerialize(initialValues) }
}

/**
 * Submit the form if its values differ from the tracker, so the comparison and
 * the baseline are about what the server holds.
 *
 * A rejected submit (the server said no) propagates for the coordinator to
 * report, and the baseline becomes unknown: the next attempt always writes, even
 * if the person has typed the old values back. Only a submit that the form
 * accepted and the server took sets it again.
 */
export async function saveDraftForm(
  form: DraftFormApi,
  tracker: DraftFormSaveTracker,
): Promise<PortalDraftSaveOutcome> {
  const submitted = stableSerialize(form.state.values)
  if (submitted === tracker.saved) return 'unchanged'
  try {
    await form.handleSubmit()
  } catch (error) {
    tracker.saved = null
    throw error
  }
  if (!form.state.isValid) return 'invalid'
  tracker.saved = submitted
  return 'saved'
}
