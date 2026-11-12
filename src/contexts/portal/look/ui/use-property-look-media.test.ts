// A logo answer touches only the logo: a focal point moved while it was on its
// way stays where it was moved.

import { createElement } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { PropertyLookMedia } from '#/contexts/portal/application/portal-management-contracts'
import { PortalDraftAutosaveProvider } from '#/contexts/portal/editor/ui/portal-draft-autosave-context'
import { act, startHookHarness, type HookHarness } from './hook-harness'
import type { usePropertyLookMedia as UsePropertyLookMedia } from './use-property-look-media'

const hero = (focalX: number, focalY: number) => ({
  assetId: 'hero-1',
  url: '/hero',
  width: 2000,
  height: 1200,
  focalX,
  focalY,
})
const logo = { assetId: 'logo-1', url: '/logo', width: 200, height: 80 }

const INITIAL: PropertyLookMedia = { hero: hero(0.5, 0.5), logo: null }

describe('usePropertyLookMedia', () => {
  let harness: HookHarness
  let useMedia: typeof UsePropertyLookMedia
  let latest: ReturnType<typeof UsePropertyLookMedia> | undefined

  beforeAll(async () => {
    harness = await startHookHarness()
    ;({ usePropertyLookMedia: useMedia } = await import('./use-property-look-media'))
  })
  afterAll(() => harness.stop())
  afterEach(async () => {
    await harness.unmount()
    latest = undefined
  })

  it('keeps a focal point moved while the logo was being saved', async () => {
    let answer: (media: PropertyLookMedia) => void = () => undefined
    const saves = {
      saveHero: vi.fn(),
      saveLogo: vi.fn(
        () =>
          new Promise<{ media: PropertyLookMedia }>((resolve) => {
            answer = (media) => resolve({ media })
          }),
      ),
    }
    function Probe() {
      latest = useMedia('property-1', INITIAL, saves as never)
      return null
    }
    await harness.render(
      createElement(PortalDraftAutosaveProvider, {
        delayMs: 60_000,
        children: createElement(Probe),
      }),
    )

    let saving!: Promise<void>
    await act(async () => {
      saving = latest!.saveLogo('logo-1')
    })
    await act(async () => latest!.moveFocal({ x: 0.2, y: 0.8 }))
    await act(async () => {
      // The answer carries the photograph as it was when the request left.
      answer({ hero: hero(0.5, 0.5), logo })
      await saving
    })

    expect(latest!.media.logo).toEqual(logo)
    expect(latest!.media.hero).toMatchObject({ focalX: 0.2, focalY: 0.8 })
  })
})
