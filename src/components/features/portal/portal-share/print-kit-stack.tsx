// The words of one face: the portal's title in small capitals, the call to
// action, the line under it, and, with two languages, a rule and the second
// language smaller beneath. The scale and the type are the PDF's.

import type { CSSProperties } from 'react'
import type { PrintFace, PrintTextBlock } from '#/shared/domain/portal-print-kit'
import {
  SINGLE_LANGUAGE_SCALE,
  TRACKING_EM,
  TYPE_PT,
} from '#/shared/domain/portal-print-kit-layout'
import type { PrintKitPalette } from '#/shared/domain/portal-print-kit-palette'
import { previewKicker } from './print-kit-art-layout'

type Props = Readonly<{
  face: PrintFace
  palette: PrintKitPalette
  /** Points on the page, as a card-relative length. */
  pt: (points: number) => string
  /** Millimetres on the page, as a card-relative length. */
  u: (millimetres: number) => string
}>

export function PrintKitStack({ face, palette, pt, u }: Props) {
  const [first, second] = face.blocks
  const scale = second ? 1 : SINGLE_LANGUAGE_SCALE
  const text = (style: CSSProperties): CSSProperties => ({ margin: 0, ...style })
  return (
    <>
      {first && (
        <FirstBlock block={first} palette={palette} scale={scale} pt={pt} u={u} />
      )}
      {second && (
        <>
          <span
            aria-hidden
            style={{
              display: 'block',
              width: u(8.5),
              height: u(0.25),
              marginTop: u(3.6),
              marginBottom: u(3.4),
              background: palette.kicker,
              opacity: 0.55,
            }}
          />
          <p
            lang={second.locale}
            style={text({
              fontFamily: 'var(--font-guest-display)',
              fontWeight: 600,
              fontSize: pt(TYPE_PT.secondHeadline),
              lineHeight: 1.15,
              color: palette.headline,
              opacity: 0.94,
            })}
          >
            {second.headline}
          </p>
          <p
            lang={second.locale}
            style={text({
              marginTop: u(0.5),
              fontSize: pt(TYPE_PT.secondSubline),
              lineHeight: 1.35,
              color: palette.body,
              opacity: 0.72,
            })}
          >
            {second.subline}
          </p>
        </>
      )}
    </>
  )
}

function FirstBlock({
  block,
  palette,
  scale,
  pt,
  u,
}: Readonly<
  { block: PrintTextBlock; palette: PrintKitPalette; scale: number } & Pick<
    Props,
    'pt' | 'u'
  >
>) {
  // A long title shrinks, then takes a second line, as it does in the file.
  const kicker = previewKicker(block.kicker, scale)
  return (
    <>
      <p
        lang={block.locale}
        style={{
          margin: 0,
          paddingLeft: `${TRACKING_EM.kicker}em`,
          fontWeight: 600,
          fontSize: pt(kicker.size),
          lineHeight: 1.4,
          letterSpacing: `${TRACKING_EM.kicker}em`,
          textTransform: 'uppercase',
          color: palette.kicker,
        }}
      >
        {kicker.lines.map((line) => (
          <span key={line} style={{ display: 'block', whiteSpace: 'nowrap' }}>
            {line}
          </span>
        ))}
      </p>
      <p
        lang={block.locale}
        style={{
          margin: 0,
          marginTop: u(1.6 * scale),
          fontFamily: 'var(--font-guest-display)',
          fontWeight: 600,
          fontSize: pt(TYPE_PT.headline * scale),
          lineHeight: 1.08,
          color: palette.headline,
          textWrap: 'balance',
        }}
      >
        {block.headline}
      </p>
      <p
        lang={block.locale}
        style={{
          margin: 0,
          marginTop: u(1 * scale),
          fontSize: pt(TYPE_PT.subline * scale),
          lineHeight: 1.35,
          color: palette.body,
          opacity: 0.84,
        }}
      >
        {block.subline}
      </p>
    </>
  )
}
