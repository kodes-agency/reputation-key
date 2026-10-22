// The words of a redesigned face, as the PDF stacks them (spec 2.2): the place
// label, the largest type on the face, with the second language's title small
// under it in the accent ink; the lead call to action; and, with two languages,
// a rule and the second call to action. With one language the rule sits between
// the place label and the call to action. Each block in its own `lang`.
//
// The sizes, line heights and gaps are the measures the PDF reads, in the face's
// own units (`pt`); headings are balanced as the PDF balances them. Both styles
// set their words this way, in their own colours: ink on Paper, white on the
// Immersive field.

import type { CSSProperties } from 'react'
import type { PrintFace, PrintTextBlock } from '#/shared/domain/portal-print-kit'
import { STACK, TYPE_PT } from '#/shared/domain/portal-print-kit-measures'
import { LINING_FIGURES } from './print-kit-art-layout'
import type { PointsToLength } from './print-kit-code-block-layout'
import type { PaperScale } from './print-kit-paper-art-layout'

/** The words' colours, from a style's palette. */
export type FaceStackColours = Readonly<{
  /** The place label and the headlines. */
  ink: string
  /** The sublines. */
  soft: string
  /** The second language's title. */
  accentInk: string
  /** The rule: Paper's accent ink, Immersive's accent line. */
  rule: string
}>

type Props = Readonly<{
  face: PrintFace
  scale: PaperScale
  align: 'centre' | 'start'
  colours: FaceStackColours
  pt: PointsToLength
  /** The place block to the call to action, when a fit step has tightened it. */
  placeToHeadPt?: number
}>

const DISPLAY: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-guest-display)',
  fontWeight: 600,
  ...LINING_FIGURES,
  textWrap: 'balance',
}

export function PrintKitFaceStack({
  face,
  scale,
  align,
  colours,
  pt,
  placeToHeadPt,
}: Props) {
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
        background: colours.rule,
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
            color: colours.ink,
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
              color: colours.accentInk,
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
          marginTop: second ? pt(placeToHeadPt ?? gaps.placeToHead ?? 0) : 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: items,
        }}
      >
        <CallToAction
          block={lead}
          colours={colours}
          pt={pt}
          sizes={[size('head'), size('sub')]}
          lead
        />
        {second && rule}
        {second && (
          <CallToAction
            block={second}
            colours={colours}
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
  colours,
  pt,
  sizes,
  lead = false,
}: Readonly<{
  block: PrintTextBlock
  colours: FaceStackColours
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
          color: colours.ink,
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
          color: colours.soft,
        }}
      >
        {block.subline}
      </p>
    </>
  )
}
