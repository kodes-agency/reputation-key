// Makes one change to a Portal's languages (add, remove, make fallback) and
// writes it through the portal's autosave coordinator, so it is serialised with
// the other saves of the same Portal and the header says "Draft saved".
//
// Framework-free, so it runs in the unit project. The change is applied when the
// write RUNS, to the languages the Portal has then (`readCurrent`), not to the
// ones it had when the menu was used: two quick changes in a row each build on
// the one before, rather than the second undoing the first or being dropped.

import type { PortalDraftAutosave } from '../portal-editor/portal-draft-autosave'
import type { OfferedGuestLocale } from '#/shared/domain/guest-locale'
import {
  applyLanguageChange,
  type PortalLanguageChange,
  type PortalLanguageSet,
} from './portal-languages-rules'

const LANGUAGES_KEY = 'languages'

export type PortalLanguageWrite = Readonly<{
  primaryGuestLocale: OfferedGuestLocale
  additionalGuestLocales: readonly OfferedGuestLocale[]
}>

type Deps = Readonly<{
  autosave: Pick<PortalDraftAutosave, 'schedule' | 'flush'>
  /** The languages the Portal has right now, read when the write runs. */
  readCurrent: () => PortalLanguageSet
  write: (next: PortalLanguageWrite) => Promise<unknown>
}>

export function createPortalLanguageChanger({
  autosave,
  readCurrent,
  write,
}: Deps): (change: PortalLanguageChange) => void {
  return (change) => {
    autosave.schedule(LANGUAGES_KEY, async () => {
      const next = applyLanguageChange(readCurrent(), change)
      if (next === null) return 'unchanged'
      await write({
        primaryGuestLocale: next.primary,
        additionalGuestLocales: [...next.additional],
      })
      return 'saved'
    })
    // A discrete choice, not typing: write it now rather than after the pause.
    void autosave.flush()
  }
}
