import PDFDocument from 'pdfkit'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { PHOTO_MIN_DPI } from '#/shared/domain/portal-print-kit-immersive'
import { cropPhotoOnce, type PhotoCrop, type PhotoCropJob } from './print-kit-photo-crops'

function newDocument(): PDFKit.PDFDocument {
  const doc = new PDFDocument({ autoFirstPage: false, font: '', compress: false })
  doc.on('data', () => undefined)
  doc.addPage({ size: [300, 300], margin: 0 })
  return doc
}

async function pixel(): Promise<Buffer> {
  return sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 90, g: 90, b: 90 } },
  })
    .png()
    .toBuffer()
}

/** A layout of a named shape whose crop is counted, at a resolution. */
async function layoutOf(shape: string, dpi: number) {
  const bytes = await pixel()
  const crop = vi.fn(async (): Promise<PhotoCrop> => ({ bytes, dpi }))
  return { shape, crop }
}

describe('cropPhotoOnce', () => {
  it('crops each shape once, however many layouts share it', async () => {
    const band = await layoutOf('band', 300)
    const panel = await layoutOf('panel', 300)
    const layouts = [band, panel, band, band]

    const photos = await cropPhotoOnce(
      newDocument(),
      layouts,
      (layout): PhotoCropJob => ({ key: layout.shape, crop: layout.crop }),
      vi.fn(),
    )

    expect(band.crop).toHaveBeenCalledTimes(1)
    expect(panel.crop).toHaveBeenCalledTimes(1)
    expect([...photos.keys()]).toEqual(['band', 'panel'])
  })

  it('skips a layout that shows no photo', async () => {
    const band = await layoutOf('band', 300)

    const photos = await cropPhotoOnce(newDocument(), [band, band], () => null, vi.fn())

    expect(photos.size).toBe(0)
    expect(band.crop).not.toHaveBeenCalled()
  })

  it('stays quiet when every crop meets the resolution a print needs', async () => {
    const warn = vi.fn()
    const crisp = await layoutOf('band', PHOTO_MIN_DPI)

    await cropPhotoOnce(
      newDocument(),
      [crisp],
      (layout) => ({ key: layout.shape, crop: layout.crop }),
      warn,
    )

    expect(warn).not.toHaveBeenCalled()
  })

  it('warns once, with the softest crop, when a crop falls below it', async () => {
    const warn = vi.fn()
    const layouts = [
      await layoutOf('band', 180),
      await layoutOf('panel', PHOTO_MIN_DPI - 30.4),
      await layoutOf('window', PHOTO_MIN_DPI - 10),
    ]

    await cropPhotoOnce(
      newDocument(),
      layouts,
      (layout) => ({ key: layout.shape, crop: layout.crop }),
      warn,
    )

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith({
      message: 'The print kit photo prints below the resolution a print needs',
      context: { dpi: Math.round(PHOTO_MIN_DPI - 30.4), minimumDpi: PHOTO_MIN_DPI },
    })
  })
})
