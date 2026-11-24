// Replacing the photograph clears what the old one was described as, in every
// language it was described in, not only the languages offered by default.

import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { setupHookRoot } from '#/shared/testing/hook-root'
import type { usePhotoDialog as UsePhotoDialog } from './use-photo-dialog'

const picker = vi.hoisted(() => ({ chosen: null as unknown, choose: vi.fn() }))
vi.mock('#/contexts/portal/look/ui/portal-media/use-image-picker', () => ({
  useImagePicker: () => ({
    chosen: picker.chosen,
    checks: [],
    message: null,
    choose: picker.choose,
  }),
}))
vi.mock('#/contexts/portal/look/ui/portal-media/image-checks', () => ({
  allImageChecksPass: () => true,
}))

const HERO = {
  assetId: 'hero-1',
  url: '/hero',
  width: 2000,
  height: 1200,
  focalX: 0.5,
  focalY: 0.5,
}

const root = setupHookRoot()

describe('usePhotoDialog', () => {
  let useDialog: typeof UsePhotoDialog
  let latest: ReturnType<typeof UsePhotoDialog> | undefined

  beforeAll(async () => {
    ;({ usePhotoDialog: useDialog } = await import('./use-photo-dialog'))
  })
  afterEach(async () => {
    latest = undefined
    picker.chosen = null
  })

  it('clears the old description in a language that is not offered by default', async () => {
    const onSave = vi.fn(async () => undefined)
    const file = new File(['x'], 'new.jpg', { type: 'image/jpeg' })
    picker.chosen = { file, previewUrl: 'data:', facts: { width: 3000, height: 2000 } }
    picker.choose.mockResolvedValue(true)
    const upload = vi.fn(async () => ({ ok: true as const, assetId: 'hero-2' }))
    function Probe() {
      latest = useDialog({
        propertyId: 'property-1',
        hero: HERO,
        locales: ['en'],
        saved: { en: 'Terrace', bg: 'Тераса' },
        onSave,
        onBusyChange: () => undefined,
        onClose: () => undefined,
        upload: upload as never,
      })
      return null
    }
    await root.render(createElement(Probe))
    await act(async () => latest!.choose(file))
    await act(async () => latest!.setIsConfirmed(true))

    await act(async () => latest!.submit())

    expect(onSave).toHaveBeenCalledTimes(1)
    const [write] = onSave.mock.calls[0] as unknown as [
      { altTexts: Array<{ locale: string; text: string | null }> },
    ]
    expect(write.altTexts).toEqual(
      expect.arrayContaining([
        { locale: 'en', text: null },
        { locale: 'bg', text: null },
      ]),
    )
  })

  it('leaves languages that are not offered alone when only the focal point is saved', async () => {
    const onSave = vi.fn(async () => undefined)
    function Probe() {
      latest = useDialog({
        propertyId: 'property-1',
        hero: HERO,
        locales: ['en'],
        saved: { en: 'Terrace', bg: 'Тераса' },
        onSave,
        onBusyChange: () => undefined,
        onClose: () => undefined,
      })
      return null
    }
    await root.render(createElement(Probe))
    await act(async () => latest!.setFocal({ x: 0.1, y: 0.1 }))

    await act(async () => latest!.submit())

    expect(onSave.mock.calls[0]).toEqual([
      { assetId: 'hero-1', focalX: 0.1, focalY: 0.1 },
    ])
  })
})
