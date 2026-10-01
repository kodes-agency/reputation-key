// The Property look page's photograph and logo: held as the server last said, and
// changed three ways. Moving the focal point autosaves through the page's
// coordinator (so the status line and the leave guard see it, like the colours).
// Putting a photograph or a logo on, or taking one off, is a deliberate act with
// its own button: it is written at once, and a refusal is thrown to the caller,
// whose dialog or button says so where the person is looking.
//
// The save answers with the media as a page draws it (size, address, focal
// point), which becomes the page's truth until the next read.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Action } from '#/components/hooks/use-action'
import type { PropertyLookMedia } from '#/contexts/portal/application/public-api'
import type { OfferedGuestLocale } from '#/shared/domain/guest-locale'
import type { PortalDraftAutosave } from '../portal-editor/portal-draft-autosave'
import { usePortalDraftAutosave } from '../portal-editor/portal-draft-autosave-context'
import type { FocalPoint } from './focal-point'

const FOCAL_KEY = 'photo-focal'

export type PropertyHeroWrite = Readonly<{
  propertyId: string
  assetId: string | null
  focalX?: number
  focalY?: number
  /** A plain array: the server function's input type is the schema's, which is mutable. */
  altTexts?: Array<{ locale: OfferedGuestLocale; text: string | null }>
}>

type Saved = Readonly<{ media: PropertyLookMedia }>

export type PropertyLookMediaSaves = Readonly<{
  saveHero: Action<{ data: PropertyHeroWrite }, Saved>
  saveLogo: Action<{ data: { propertyId: string; assetId: string | null } }, Saved>
}>

/**
 * Run a deliberate write once the focal autosave has finished. A focal write
 * still waiting out its debounce, or in flight, would otherwise reach the server
 * after the new photograph and put the old one back.
 */
export async function afterPendingAutosaves<T>(
  autosave: Pick<PortalDraftAutosave, 'flush'>,
  write: () => Promise<T>,
): Promise<T> {
  await autosave.flush()
  return write()
}

const focalOf = (media: PropertyLookMedia): FocalPoint | null =>
  media.hero ? { x: media.hero.focalX, y: media.hero.focalY } : null

export function usePropertyLookMedia(
  propertyId: string,
  initial: PropertyLookMedia,
  saves: PropertyLookMediaSaves,
) {
  const autosave = usePortalDraftAutosave()
  const [media, setMediaState] = useState(initial)
  const mediaRef = useRef(media)
  /** The focal point the server holds, so a drag back to it writes nothing. */
  const savedFocalRef = useRef(focalOf(initial))
  const savesRef = useRef(saves)
  useEffect(() => {
    savesRef.current = saves
  })

  const land = useCallback((next: PropertyLookMedia) => {
    mediaRef.current = next
    savedFocalRef.current = focalOf(next)
    setMediaState(next)
  }, [])

  const moveFocal = useCallback(
    (focal: FocalPoint) => {
      const { hero } = mediaRef.current
      if (!hero) return
      mediaRef.current = {
        ...mediaRef.current,
        hero: { ...hero, focalX: focal.x, focalY: focal.y },
      }
      setMediaState(mediaRef.current)
      autosave.schedule(FOCAL_KEY, async () => {
        const current = mediaRef.current.hero
        const saved = savedFocalRef.current
        if (!current) return 'unchanged'
        if (saved && saved.x === current.focalX && saved.y === current.focalY) {
          return 'unchanged'
        }
        const result = await savesRef.current.saveHero({
          data: {
            propertyId,
            assetId: current.assetId,
            focalX: current.focalX,
            focalY: current.focalY,
          },
        })
        // Where the server holds it now; the drag may have moved on since.
        savedFocalRef.current = focalOf(result.media)
        return 'saved'
      })
    },
    [autosave, propertyId],
  )

  const saveHero = useCallback(
    async (write: Omit<PropertyHeroWrite, 'propertyId'>) => {
      const result = await afterPendingAutosaves(autosave, () =>
        savesRef.current.saveHero({ data: { propertyId, ...write } }),
      )
      land(result.media)
    },
    [autosave, land, propertyId],
  )

  const saveLogo = useCallback(
    async (assetId: string | null) => {
      const result = await savesRef.current.saveLogo({ data: { propertyId, assetId } })
      land(result.media)
    },
    [land, propertyId],
  )

  return { media, moveFocal, saveHero, saveLogo }
}
