// The words of a redesigned face, as the PDF stacks them (spec 2.2): the place
// label, the largest type on the face, with the second language's title small
// under it in the accent ink; the lead call to action; and, with two languages,
// a rule and the second call to action. With one language the rule sits between
// the place label and the call to action. Each block in its own `lang`.
//
// The sizes, line heights and gaps are the measures the PDF reads, in the face's
// own units (`pt`); headings are balanced as the PDF balances them.

import type { CSSProperties } from 'react'
import type { PrintFace, PrintTextBlock } from '#/shared/domain/portal-print-kit'
import { STACK, TYPE_PT } from '#/shared/domain/portal-print-kit-measures'
import type { PaperPrintKitPalette } from '#/shared/domain/portal-print-kit-palette'
import { LINING_FIGURES } from './print-kit-art-layout'
import type { PointsToLength } from './print-kit-code-block-layout'
import type { PaperScale } from './print-kit-paper-art-layout'

type Props = Readonly<{
  face: PrintFace
  scale: PaperScale
  align: 'centre' | 'start'
  palette: PaperPrintKitPalette
  pt: PointsToLength
}>

const DISPLAY: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-guest-display)',
  fontWeight: 600,
  ...LINING_FIGURES,
  textWrap: 'balance',
}

export function PrintKitPaperStack({ face, scale, align, palette, pt }: Props) {
  const [lead, second] = face.blocks
  if (lead === undefined) return null
  const type: Readonly<Record<string, number>> = TYPE_PT[scale]
  const { leading } = STACK
  const tent = scale === 'tent'
  const gaps: Readonly<{ rule: number; placeToHead?: number }> = STACK.gapsPt[scale]
  const items = align === 'centre' ? 'center' : 'flex-start'
  const rule = (
    <span
      aria-hidden
      style={{
        display: 'block',
        flex: 'none',
        width: pt(tent ? STACK.rule.tentWidthPt : STACK.rule.widthPt),
        height: pt(tent ? STACK.rule.tentWeightPt : STACK.rule.weightPt),
        margin: `${pt(gaps.rule)} 0`,
        background: palette.accentInk,
      }}
    />
  )
  const size = (key: string) => pt(type[key] ?? 0)
  return (
    <>
      <div
        style={{
          flex: 'none',
          display: 'flex',
          flexDirection: 'column',
          alignItems: items,
          gap: pt(STACK.placeGapPt),
        }}
      >
        <p
          lang={lead.locale}
          style={{
            ...DISPLAY,
            fontSize: size('place'),
            lineHeight: leading.place,
            letterSpacing: `${STACK.trackingEm.place}em`,
            color: palette.ink,
          }}
        >
          {lead.kicker}
        </p>
        {second && (
          <p
            lang={second.locale}
            style={{
              margin: 0,
              fontWeight: 600,
              fontSize: size('place2'),
              lineHeight: leading.place2,
              letterSpacing: `${STACK.trackingEm.place2}em`,
              color: palette.accentInk,
            }}
          >
            {second.kicker}
          </p>
        )}
      </div>
      {second === undefined && rule}
      <div
        style={{
          flex: 'none',
          marginTop: second ? pt(gaps.placeToHead ?? 0) : 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: items,
        }}
      >
        <CallToAction
          block={lead}
          palette={palette}
          pt={pt}
          sizes={[size('head'), size('sub')]}
          lead
        />
        {second && rule}
        {second && (
          <CallToAction
            block={second}
            palette={palette}
            pt={pt}
            sizes={[size('head2'), size('sub2')]}
          />
        )}
      </div>
    </>
  )
}

function CallToAction({
  block,
  palette,
  pt,
  sizes,
  lead = false,
}: Readonly<{
  block: PrintTextBlock
  palette: PaperPrintKitPalette
  pt: PointsToLength
  sizes: readonly [string, string]
  lead?: boolean
}>) {
  const { leading } = STACK
  return (
    <>
      <p
        lang={block.locale}
        style={{
          ...DISPLAY,
          fontSize: sizes[0],
          lineHeight: lead ? leading.head : leading.head2,
          color: palette.ink,
        }}
      >
        {block.headline}
      </p>
      <p
        lang={block.locale}
        style={{
          margin: 0,
          marginTop: pt(lead ? STACK.subAbovePt : STACK.sub2AbovePt),
          fontSize: sizes[1],
          lineHeight: lead ? leading.sub : leading.sub2,
          color: palette.soft,
        }}
      >
        {block.subline}
      </p>
    </>
  )
}
