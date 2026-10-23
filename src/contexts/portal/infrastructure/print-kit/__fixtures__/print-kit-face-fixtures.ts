// Faces laid out as the PDF lays them, for the fit tests: a document with the
// guest fonts, a face of the Portal's words, a light logo like the boards', and
// a layout of either style on any face shape.

import PDFDocument from 'pdfkit'
import sharp from 'sharp'
import {
  printKitFaces,
  type PrintFace,
  type PrintKitWords,
} from '#/shared/domain/portal-print-kit'
import {
  immersivePrintKitPalette,
  paperPrintKitPalette,
} from '#/shared/domain/portal-print-kit-palette'
import type { PanelGeometry } from '#/shared/domain/portal-print-kit-sheets'
import type { FaceLogo } from '../print-kit-face-brand'
import type { FaceStack, FaceStackLine } from '../print-kit-face-stack'
import { logoInk } from '../print-kit-image'
import {
  layoutImmersiveFace,
  type ImmersiveFaceLayout,
} from '../print-kit-immersive-face'
import { layoutPaperFace, type PaperFaceLayout } from '../print-kit-paper-face'
import { openImage } from '../print-kit-pdf-image'
import { PrintKitFonts } from '../print-kit-pdf-text'
import { qrMatrix } from '../print-kit-qr'

const QR = qrMatrix('https://app.reputationkey.app/p/pt_AbCdEfGhIjKlMnOp_AbCdEf')

export const POOL = {
  en: 'Pool & Terrace',
  es: 'Piscina y terraza',
  bg: 'Басейн и тераса',
}

export function newDocument() {
  const doc = new PDFDocument({ autoFirstPage: false, font: '', compress: false })
  doc.on('data', () => undefined)
  doc.addPage({ size: [612, 792], margin: 0 })
  return { doc, fonts: new PrintKitFonts(doc) }
}

/** The front of a print of `choice`, with the Portal's titles. */
export function faceOf(
  choice: Omit<PrintKitWords, 'callToAction'> & { callToAction?: 'rate' | 'tell' },
  titles: Readonly<Record<string, string>> = POOL,
): PrintFace {
  const [front] = printKitFaces({ callToAction: 'rate', ...choice }, titles, 'Portal')
  if (front === undefined) throw new Error('no face')
  return front
}

/**
 * A light logo like the boards': a cream drawing `drawn` px tall under `edge` px
 * of transparent edge, 900 px wide, so a 60 mm box sets it 14.7 mm tall.
 */
export async function lightLogo(
  doc: PDFKit.PDFDocument,
  size: Readonly<{ height: number; edge: number }> = { height: 220, edge: 23 },
): Promise<FaceLogo> {
  const drawing = await sharp({
    create: {
      width: 900,
      height: size.height - size.edge,
      channels: 4,
      background: '#F6F1E8',
    },
  })
    .png()
    .toBuffer()
  const bytes = await sharp({
    create: {
      width: 900,
      height: size.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: drawing, top: size.edge, left: 0 }])
    .png()
    .toBuffer()
  const raw = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { image: openImage(doc, bytes), ink: logoInk(raw.data, raw.info), plate: null }
}

export type FaceOptions = Readonly<{
  logo?: boolean | Readonly<{ height: number; edge: number }>
  wordmark?: string
  accent?: string
}>

const logoOf = (doc: PDFKit.PDFDocument, options: FaceOptions) =>
  options.logo === undefined || options.logo === false
    ? Promise.resolve(null)
    : lightLogo(doc, options.logo === true ? undefined : options.logo)

export async function layOutImmersive(
  face: PrintFace,
  geometry: PanelGeometry,
  options: FaceOptions = {},
): Promise<ImmersiveFaceLayout> {
  const { doc, fonts } = newDocument()
  const palette = immersivePrintKitPalette(options.accent ?? '#EAD6A8', null)
  const logo = await logoOf(doc, options)
  const brand = { wordmark: options.wordmark ?? 'Avela', colour: palette.headline, logo }
  return layoutImmersiveFace(doc, fonts, face, { palette, qr: QR, brand }, geometry)
}

export async function layOutPaper(
  face: PrintFace,
  geometry: PanelGeometry,
  options: FaceOptions = {},
): Promise<PaperFaceLayout> {
  const { doc, fonts } = newDocument()
  const palette = paperPrintKitPalette(options.accent ?? '#EAD6A8')
  const logo = await logoOf(doc, options)
  const brand = { wordmark: options.wordmark ?? 'Avela', colour: palette.ink, logo }
  return layoutPaperFace(doc, fonts, face, { palette, qr: QR, brand }, geometry)
}

/** The lines of a laid-out stack. */
export const stackLines = (
  layout: Readonly<{ stack: Readonly<{ stack: FaceStack }> }>,
): readonly FaceStackLine[] =>
  layout.stack.stack.items.filter((item): item is FaceStackLine => item.kind === 'line')

/** The space between the words' last line and the code block. */
export const wordsToCode = (
  layout: Readonly<{
    stack: Readonly<{ y: number; stack: Readonly<{ heightPt: number }> }>
    code: Readonly<{ y: number }>
  }>,
): number => layout.code.y - (layout.stack.y + layout.stack.stack.heightPt)
