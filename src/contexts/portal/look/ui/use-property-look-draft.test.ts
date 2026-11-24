// A Property look draft belongs to the person editing it. The page's read is
// refreshed after every save, so a refresh must not overwrite the words or the
// languages being edited, and opening the page again starts from what the
// server holds.
//
// The hook is mounted under the page's own autosave provider.

import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { PortalDraftAutosaveProvider } from '#/contexts/portal/editor/ui/portal-draft-autosave-context'
import { setupHookRoot } from '#/shared/testing/hook-root'
import type { PropertyLookProfile } from './property-look-types'
import type { PropertyLookSaves } from './use-property-look-draft'

const SAVED: PropertyLookProfile = {
  displayName: 'Property',
  primaryColor: '#EAD6A8',
  backgroundColor: '#1B1410',
  backgroundMode: 'auto',
  wordmark: 'Saved',
  defaultGuestLocales: ['en'],
}
const CHANGED_ELSEWHERE: PropertyLookProfile = {
  ...SAVED,
  wordmark: 'Changed elsewhere',
  defaultGuestLocales: ['de'],
}
/** Long enough that no autosave fires while a test runs; unmounting still flushes. */
const AUTOSAVE_DELAY_MS = 60_000

const saves = {
  saveLook: vi.fn(async () => SAVED),
  saveLocales: vi.fn(async () => ({ defaultGuestLocales: ['bg'] })),
} as unknown as PropertyLookSaves

const root = setupHookRoot()

describe('usePropertyLookDraft', () => {
  let usePropertyLookDraft: typeof import('./use-property-look-draft').usePropertyLookDraft
  let latest: ReturnType<typeof usePropertyLookDraft> | undefined

  beforeAll(async () => {
    ;({ usePropertyLookDraft } = await import('./use-property-look-draft'))
  })

  afterEach(() => {
    latest = undefined
  })

  function Probe({ profile }: Readonly<{ profile: PropertyLookProfile }>) {
    latest = usePropertyLookDraft('property-1', profile, saves)
    return null
  }

  const showPage = (profile: PropertyLookProfile) =>
    root.render(
      createElement(PortalDraftAutosaveProvider, {
        delayMs: AUTOSAVE_DELAY_MS,
        children: createElement(Probe, { profile }),
      }),
    )

  function page() {
    if (!latest) throw new Error('the page has not rendered')
    return latest
  }

  const leavePage = root.unmount

  it('keeps the words and languages being edited when the read refreshes', async () => {
    await showPage(SAVED)
    await act(async () => page().setDraft({ wordmark: 'Still editing' }))
    await act(async () => page().setLocales(['bg']))

    await showPage(CHANGED_ELSEWHERE)

    expect(page().draft.wordmark).toBe('Still editing')
    expect(page().locales).toEqual(['bg'])
  })

  it('starts from what the server holds when the page is opened again', async () => {
    await showPage(SAVED)
    await act(async () => page().setDraft({ wordmark: 'Still editing' }))
    await leavePage()

    await showPage(CHANGED_ELSEWHERE)

    expect(page().draft.wordmark).toBe('Changed elsewhere')
    expect(page().locales).toEqual(['de'])
  })
})
