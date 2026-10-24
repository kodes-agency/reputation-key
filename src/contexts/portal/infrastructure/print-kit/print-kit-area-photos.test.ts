// The photo areas of a small tent's panels as the PDF crops them: nothing
// cropped when there is no photo or no area, one crop for the faces whose areas
// are the same size, a report under 200 dpi and a refusal under 120.

import PDFDocument from 'pdfkit'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { PrintKitRenderRefusal } from '../../application/ports/portal-print-kit-renderer.port'
import { CODE_TILE } from '#/shared/domain/portal-print-kit-code-tile'
import { printKitSheetPages } from '#/shared/domain/portal-print-kit-formats'
import type { PrintKitPagePanel } from '#/shared/domain/portal-print-kit-sheets'
import { areaPhotos, type AreaOf } from './print-kit-area-photos'
import { panelLayouts } from './print-kit-pages'

/** A face's layout as far as its photo area goes: the panel's width and the face's height. */
type Layout = Readonly<{ panelPt: number | null; heightPt: number }>

const PANEL: Layout = { panelPt: 86.4, heightPt: 252 }

/** The panel down a tent's left with its bleed, as the tent print asks for it. */
const panelArea: AreaOf<Layout> = (layout, bleed) =>
  layout.panelPt === null
    ? null
    : {
        widthPt: layout.panelPt + bleed.leftPt,
        heightPt: layout.heightPt + bleed.topPt + bleed.bottomPt,
      }

const newDocument = (): PDFKit.PDFDocument => {
  const doc = new PDFDocument({ autoFirstPage: false, font: '', compress: false })
  doc.on('data', () => undefined)
  doc.addPage({ size: [612, 792], margin: 0 })
  return doc
}

/** A flat grey photo, `width` × `height` pixels. */
const photoOf = async (width: number, height: number) => ({
  bytes: await sharp({
    create: { width, height, channels: 3, background: { r: 120, g: 120, b: 120 } },
  })
    .jpeg()
    .toBuffer(),
  focalX: 0.5,
  focalY: 0.5,
})

/** The faces of a small tent print on its pages, each with the same layout. */
function placedOn(
  style: 'paper' | 'immersive',
  layout: Layout,
): readonly Readonly<{ panel: PrintKitPagePanel; layout: Layout }>[] {
  const pages = printKitSheetPages({
    piece: 'table_tent',
    size: 'table',
    style,
    output: style === 'paper' ? 'office' : 'print_shop',
    languageCount: 1,
    paper: 'letter',
    faceCount: 2,
    tilePt: CODE_TILE.table.letter.tilePt,
  })
  const layouts = new Map(
    pages
      .flatMap((page) => page.panels)
      .map((panel) => [`${panel.side}:${panel.geometry}`, layout] as const),
  )
  return panelLayouts(pages, layouts)
}

describe('areaPhotos', () => {
  it('crops nothing without a photo, and gives every face the monogram', async () => {
    const doc = newDocument()
    const opened = vi.spyOn(doc, 'openImage')
    const placed = placedOn('immersive', PANEL)

    const photoAt = await areaPhotos(doc, null, placed, panelArea, vi.fn())

    expect(opened).not.toHaveBeenCalled()
    for (const { panel, layout } of placed) {
      expect(photoAt(layout, panel.bleed)).toBeNull()
    }
  })

  it('draws no photo on a face that has no area for one', async () => {
    const doc = newDocument()
    const opened = vi.spyOn(doc, 'openImage')
    const none: Layout = { panelPt: null, heightPt: 252 }
    const placed = placedOn('immersive', none)

    const photoAt = await areaPhotos(
      doc,
      await photoOf(800, 2400),
      placed,
      panelArea,
      vi.fn(),
    )

    expect(opened).not.toHaveBeenCalled()
    expect(photoAt(none, { topPt: 0, rightPt: 9, bottomPt: 9, leftPt: 9 })).toBeNull()
  })

  it('crops once for the front and back of an Immersive tent, whose areas match', async () => {
    const doc = newDocument()
    const opened = vi.spyOn(doc, 'openImage')
    const placed = placedOn('immersive', PANEL)
    expect(placed).toHaveLength(2)

    const photoAt = await areaPhotos(
      doc,
      await photoOf(800, 2400),
      placed,
      panelArea,
      vi.fn(),
    )

    expect(opened).toHaveBeenCalledTimes(1)
    const [front, back] = placed.map(({ panel, layout }) => photoAt(layout, panel.bleed))
    expect(front).not.toBeNull()
    expect(back).toBe(front)
  })

  it('crops an area with no bleed apart from the same panel with one', async () => {
    const doc = newDocument()
    const opened = vi.spyOn(doc, 'openImage')
    const bleeding = placedOn('immersive', PANEL)
    const flat = placedOn('paper', PANEL)

    const photoAt = await areaPhotos(
      doc,
      await photoOf(800, 2400),
      [...bleeding, ...flat],
      panelArea,
      vi.fn(),
    )

    expect(opened).toHaveBeenCalledTimes(2)
    const sample = (placed: typeof flat) =>
      placed[0] === undefined ? null : photoAt(placed[0].layout, placed[0].panel.bleed)
    expect(sample(flat)).not.toBeNull()
    expect(sample(flat)).not.toBe(sample(bleeding))
  })

  it('stays quiet when the photo prints at 200 dpi or more', async () => {
    const warn = vi.fn()

    await areaPhotos(
      newDocument(),
      await photoOf(800, 2400),
      placedOn('immersive', PANEL),
      panelArea,
      warn,
    )

    expect(warn).not.toHaveBeenCalled()
  })

  it('reports a photo that prints under 200 dpi and still prints it', async () => {
    const warn = vi.fn()

    const photoAt = await areaPhotos(
      newDocument(),
      await photoOf(200, 600),
      placedOn('immersive', PANEL),
      panelArea,
      warn,
    )

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0].context).toMatchObject({ minimumDpi: 200 })
    const [first] = placedOn('immersive', PANEL)
    expect(first && photoAt(first.layout, first.panel.bleed)).not.toBeNull()
  })

  it('refuses a photo that prints under 120 dpi', async () => {
    const soft = areaPhotos(
      newDocument(),
      await photoOf(100, 300),
      placedOn('immersive', PANEL),
      panelArea,
      vi.fn(),
    )

    await expect(soft).rejects.toBeInstanceOf(PrintKitRenderRefusal)
    await expect(soft).rejects.toMatchObject({
      refusal: { code: 'print_photo_too_soft', minimumDpi: 120 },
    })
  })
})
