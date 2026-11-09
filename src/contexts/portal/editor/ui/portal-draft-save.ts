import type { PortalDraftSaveOutcome } from './portal-draft-autosave'

export type DraftSaveTracker<T> = { saved: T | null }

/** A rejected request may have committed, so only an accepted save restores certainty. */
export async function trackDraftSave<T>(
  tracker: DraftSaveTracker<T>,
  save: (saved: T | null) => Promise<{
    outcome: PortalDraftSaveOutcome
    saved: T | null
  }>,
): Promise<PortalDraftSaveOutcome> {
  try {
    const result = await save(tracker.saved)
    tracker.saved = result.saved
    return result.outcome
  } catch (error) {
    tracker.saved = null
    throw error
  }
}
