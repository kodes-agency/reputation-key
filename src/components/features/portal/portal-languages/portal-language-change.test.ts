import { afterEach, describe, expect, it, vi } from 'vitest'
import { harness } from '../portal-editor/portal-draft-autosave-harness'
import {
  createPortalLanguageChanger,
  type PortalLanguageWrite,
} from './portal-language-change'
import type { PortalLanguageSet } from './portal-languages-rules'

afterEach(() => vi.useRealTimers())

// The write lands in `current` on the next tick, as the optimistic cache update
// does, so a change that runs after it reads the languages it left behind.
function setup(initial: PortalLanguageSet) {
  let current = initial
  const writes: PortalLanguageWrite[] = []
  const { autosave } = harness()
  const change = createPortalLanguageChanger({
    autosave,
    readCurrent: () => current,
    write: async (next) => {
      writes.push(next)
      current = {
        primary: next.primaryGuestLocale,
        additional: next.additionalGuestLocales,
      }
    },
  })
  return { change, writes, autosave, current: () => current }
}

describe('createPortalLanguageChanger', () => {
  it('writes one change at once, without waiting out the typing pause', async () => {
    const { change, writes, autosave } = setup({ primary: 'en', additional: [] })
    change({ kind: 'add', locale: 'bg' })
    await vi.advanceTimersByTimeAsync(0)
    await autosave.flush()
    expect(writes).toEqual([{ primaryGuestLocale: 'en', additionalGuestLocales: ['bg'] }])
  })

  it('builds each of two back-to-back changes on the one before', async () => {
    const { change, writes, autosave, current } = setup({ primary: 'en', additional: [] })
    change({ kind: 'add', locale: 'bg' })
    change({ kind: 'make_fallback', locale: 'bg' })
    await vi.advanceTimersByTimeAsync(0)
    await autosave.flush()
    expect(writes).toEqual([
      { primaryGuestLocale: 'en', additionalGuestLocales: ['bg'] },
      { primaryGuestLocale: 'bg', additionalGuestLocales: ['en'] },
    ])
    expect(current()).toEqual({ primary: 'bg', additional: ['en'] })
  })

  it('writes nothing for a change that no longer applies', async () => {
    const { change, writes, autosave } = setup({ primary: 'en', additional: ['bg'] })
    change({ kind: 'add', locale: 'bg' })
    await vi.advanceTimersByTimeAsync(0)
    await autosave.flush()
    expect(writes).toEqual([])
  })
})
