// The words, marks and code of a final face in the Share tab's preview (final
// design spec §2 to §5, §8), drawn from the layout the PDF draws from, in
// either look's colours: the logo (on its cream plate when it has one) or the
// wordmark, the words, the rule between two languages and the code block, each
// part where the file puts its ink. Every part is placed absolutely in the
// face's container units, so the face scales with its column.
//
// Inline styles on purpose, as the rest of the print preview's: the first-paint
// stylesheet is built by scanning `src/` for class names, and a measure this
// specific would land in every page's.

import type { CSSProperties } from 'react'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import { PRINT_FINAL_PLATE } from '#/shared/domain/portal-print-final-brand'
import {
  printFinalToneColour,
  type PrintFinalColours,
} from '#/shared/domain/portal-print-final-colours'
import type {
  PrintFinalContent,
  PrintFinalFaceLayout,
} from '#/shared/domain/portal-print-final-face'
import type { PrintFinalPlacedPart } from '#/shared/domain/portal-print-final-parts'
import type { PrintFinalSetText } from '#/shared/domain/portal-print-final-text'
import { PRINT_KIT_TILE } from '#/shared/domain/portal-print-kit-palette'
import { LINING_FIGURES } from './print-kit-art-layout'
import type { PointsToLength } from './print-kit-code-block-layout'
import { PrintFinalCodeArt } from './print-final-code-art'
import { previewLineTopPt } from './print-final-face-layout'

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
export function Lines({
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

export type PartProps = Readonly<{
  content: PrintFinalContent
  part: PrintFinalPlacedPart
  colours: PrintFinalColours
  look: PortalPrintKitView['look']
  onLogoAspect: (aspect: number) => void
  pt: PointsToLength
}>

/** The logo filling its planned box, or the box inside its plate's padding on the cream plate. */
export function Logo({ content, part, look, onLogoAspect, pt }: PartProps) {
  if (content.kind !== 'logo' || look.logoUrl === null) return null
  const { paddingPt } = content.box
  const image = (
    <img
      src={look.logoUrl}
      alt=""
      onLoad={(event) => {
        const { naturalWidth, naturalHeight } = event.currentTarget
        if (naturalWidth > 0 && naturalHeight > 0)
          onLogoAspect(naturalWidth / naturalHeight)
      }}
      style={{
        position: 'absolute',
        left: pt(paddingPt.h),
        top: pt(paddingPt.v),
        width: pt(content.box.logo.widthPt),
        height: pt(content.box.logo.heightPt),
        display: 'block',
        maxWidth: 'none',
        objectFit: 'contain',
      }}
    />
  )
  return (
    <span
      style={{
        ...boxOf(pt, part),
        display: 'block',
        borderRadius: paddingPt.h > 0 ? pt(PRINT_FINAL_PLATE.radiusPt) : 0,
        background: paddingPt.h > 0 ? PRINT_KIT_TILE : 'transparent',
      }}
    >
      {image}
    </span>
  )
}

function Part(props: PartProps) {
  const { content, part, colours, pt } = props
  switch (content.kind) {
    case 'wordmark':
      return (
        <Lines set={content.set} part={part} colour={colours.ink} lang={null} pt={pt} />
      )
    case 'words':
      return (
        <Lines
          set={content.set}
          part={part}
          colour={printFinalToneColour(colours, content.tone)}
          lang={content.locale}
          pt={pt}
        />
      )
    case 'rule':
      return (
        <span aria-hidden style={{ ...boxOf(pt, part), background: colours.accent }} />
      )
    case 'logo':
      return <Logo {...props} />
  }
}

type Props = Readonly<{
  layout: PrintFinalFaceLayout
  colours: PrintFinalColours
  look: PortalPrintKitView['look']
  codeUrl: string | null
  onLogoAspect: (aspect: number) => void
  pt: PointsToLength
}>

/** Every part of a laid-out face, and its code block. */
export function PrintFinalFaceParts({
  layout,
  colours,
  look,
  codeUrl,
  onLogoAspect,
  pt,
}: Props) {
  return (
    <>
      {layout.plan.parts.map((part, index) => {
        const content = layout.contents[index]
        return content === undefined ? null : (
          <Part
            key={part.key}
            content={content}
            part={part}
            colours={colours}
            look={look}
            onLogoAspect={onLogoAspect}
            pt={pt}
          />
        )
      })}
      <PrintFinalCodeArt layout={layout} colours={colours} codeUrl={codeUrl} pt={pt} />
    </>
  )
}
