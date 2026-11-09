import { trackDraftSave, type DraftSaveTracker } from '../portal-draft-save'
import { isSavedLinkAddress } from './link-address-field'

export const addressNeedsSave = (value: string, saved: string | null): boolean =>
  saved === null || !isSavedLinkAddress(value, saved)

export async function saveLinkAddress(
  value: string,
  tracker: DraftSaveTracker<string>,
  write: () => Promise<unknown>,
): Promise<void> {
  if (!addressNeedsSave(value, tracker.saved)) return
  await trackDraftSave(tracker, async () => {
    await write()
    return { outcome: 'saved', saved: value }
  })
}
