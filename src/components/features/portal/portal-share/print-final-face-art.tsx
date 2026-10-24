// A final Paper face in the Share tab's preview (final design spec §2 to §5, §7
// and §8), drawn from the layout the PDF draws from (`previewFinalFaceLayout`):
// the logo or the wordmark, the stars, the words, the rule between two
// languages and the code block, each part where the file puts its ink. Every
// part is placed absolutely in the face's container units, so the face scales
// with its column.
//
// Inline styles on purpose, as the rest of the print preview's: the first-paint
// stylesheet is built by scanning `src/` for class names, and a measure this
// specific would land in every page's.

import { useState, type CSSProperties } from 'react'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import type { PrintTextBlock } from '#/shared/domain/portal-print-kit'
import type { PrintFinalFace } from '#/shared/domain/portal-print-final'
import type { PrintFinalTile } from '#/shared/domain/portal-print-final-code'
import type { PrintFinalContent } from '#/shared/domain/portal-print-final-face'
import { PRINT_FINAL_STAR } from '#/shared/domain/portal-print-final-marks'
import type { PrintFinalPlacedPart } from '#/shared/domain/portal-print-final-parts'
import type { PrintFinalSetText } from '#/shared/domain/portal-print-final-text'
import type { PrintFinalTone } from '#/shared/domain/portal-print-final-words'
import {
  PRINT_KIT_PAPER,
  paperPrintKitPalette,
  type PaperPrintKitPalette,
} from '#/shared/domain/portal-print-kit-palette'
import { LINING_FIGURES } from './print-kit-art-layout'
import type { PointsToLength } from './print-kit-code-block-layout'
import { PrintFinalCodeArt } from './print-final-code-art'
import { previewFinalFaceLayout, previewLineTopPt } from './print-final-face-layout'

type Props = Readonly<{
  face: PrintFinalFace
  blocks: readonly PrintTextBlock[]
  look: PortalPrintKitView['look']
  tile: PrintFinalTile
  /** The code as a picture with its quiet zone drawn in; null while it is made. */
  codeUrl: string | null
  pt: PointsToLength
}>

const toneColour = (palette: PaperPrintKitPalette, tone: PrintFinalTone): string =>
  ({ ink: palette.ink, soft: palette.soft, accent: palette.accentInk })[tone]

function fontOf(set: PrintFinalSetText, pt: PointsToLength): CSSProperties {
  const { style } = set
  return {
    fontFamily:
      style.family === 'serif' ? 'var(--font-guest-display)' : 'var(--font-guest-body)',
    fontWeight: style.weight,
    fontStyle: style.italic ? 'italic' : 'normal',
    fontSize: pt(style.sizePt),
    lineHeight: pt(style.sizePt * style.leading),
    letterSpacing: `${style.trackingEm}em`,
    // The file sets a tracked line letter by letter: no ligature joins a TT.
    fontVariantLigatures: style.trackingEm > 0 ? 'none' : 'normal',
    ...(style.family === 'serif' ? LINING_FIGURES : {}),
  }
}

/** A set part's lines, each on its baseline from its pen origin. */
function Lines({
  set,
  part,
  colour,
  lang,
  pt,
}: Readonly<{
  set: PrintFinalSetText
  part: PrintFinalPlacedPart
  colour: string
  lang: string | null
  pt: PointsToLength
}>) {
  const font = fontOf(set, pt)
  return set.lines.map((line) => (
    <span
      key={`${line.baselinePt}:${line.text}`}
      {...(lang === null ? {} : { lang })}
      style={{
        ...font,
        position: 'absolute',
        left: pt(part.xPt + line.originPt),
        top: pt(previewLineTopPt(set.style, part.yPt + line.baselinePt)),
        whiteSpace: 'nowrap',
        color: colour,
      }}
    >
      {line.text}
    </span>
  ))
}

const boxOf = (pt: PointsToLength, part: PrintFinalPlacedPart): CSSProperties => ({
  position: 'absolute',
  left: pt(part.xPt),
  top: pt(part.yPt),
  width: pt(part.widthPt),
  height: pt(part.heightPt),
})

type PartProps = Readonly<{
  content: PrintFinalContent
  part: PrintFinalPlacedPart
  palette: PaperPrintKitPalette
  look: PortalPrintKitView['look']
  onLogoAspect: (aspect: number) => void
  pt: PointsToLength
}>

function Stars({ content, part, palette, pt }: PartProps) {
  if (content.kind !== 'stars') return null
  const { stars } = content
  const { grid, path } = PRINT_FINAL_STAR
  return stars.origins.map((origin) => (
    <svg
      key={origin.xPt}
      aria-hidden
      viewBox={`0 0 ${grid} ${grid}`}
      fill="none"
      stroke={palette.accentInk}
      strokeWidth={(stars.strokePt / stars.sizePt) * grid}
      strokeLinejoin="round"
      style={{
        position: 'absolute',
        left: pt(part.xPt + origin.xPt),
        top: pt(part.yPt + origin.yPt),
        width: pt(stars.sizePt),
        height: pt(stars.sizePt),
        overflow: 'visible',
      }}
    >
      <path d={path} />
    </svg>
  ))
}

function Part(props: PartProps) {
  const { content, part, palette, look, pt } = props
  switch (content.kind) {
    case 'wordmark':
      return (
        <Lines set={content.set} part={part} colour={palette.ink} lang={null} pt={pt} />
      )
    case 'words':
      return (
        <Lines
          set={content.set}
          part={part}
          colour={toneColour(palette, content.tone)}
          lang={content.locale}
          pt={pt}
        />
      )
    case 'stars':
      return <Stars {...props} />
    case 'rule':
      return (
        <span aria-hidden style={{ ...boxOf(pt, part), background: palette.accentInk }} />
      )
    case 'logo':
      return look.logoUrl === null ? null : (
        <img
          src={look.logoUrl}
          alt=""
          onLoad={(event) => {
            const { naturalWidth, naturalHeight } = event.currentTarget
            if (naturalWidth > 0 && naturalHeight > 0)
              props.onLogoAspect(naturalWidth / naturalHeight)
          }}
          style={{
            ...boxOf(pt, part),
            display: 'block',
            maxWidth: 'none',
            objectFit: 'contain',
          }}
        />
      )
  }
}

export function PrintFinalFaceArt({ face, blocks, look, tile, codeUrl, pt }: Props) {
  const [logoAspect, setLogoAspect] = useState<number | null>(null)
  const layout = previewFinalFaceLayout({ face, blocks, look, tile, logoAspect })
  const palette = paperPrintKitPalette(look.accentColour)
  const { plan } = layout
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: PRINT_KIT_PAPER,
      }}
    >
      {plan.parts.map((part, index) => {
        const content = layout.contents[index]
        return content === undefined ? null : (
          <Part
            key={part.key}
            content={content}
            part={part}
            palette={palette}
            look={look}
            onLogoAspect={setLogoAspect}
            pt={pt}
          />
        )
      })}
      <PrintFinalCodeArt layout={layout} palette={palette} codeUrl={codeUrl} pt={pt} />
    </div>
  )
}
