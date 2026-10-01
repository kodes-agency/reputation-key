// One face of a print, drawn as the PDF draws it: the whole page, with the crop
// marks, the bleed and the trim, and on the trim the brand, the words, the
// code on its plate and the address. Every measure is a number from
// `portal-print-kit-layout.ts`, the file the PDF reads, laid out in container
// units so the card scales with its column.
//
// Inline styles on purpose, as the guest preview's are: the first-paint
// stylesheet is built by scanning `src/` for class names, and a measure this
// specific would be added to the stylesheet of every page in production.

import type { CSSProperties } from 'react'
import {
  A6_HEIGHT_MM,
  A6_WIDTH_MM,
  PRINT_KIT_BLEED_MM,
  type PrintFace,
  type PrintKitPiece,
} from '#/shared/domain/portal-print-kit'
import {
  ADDRESS_OPACITY,
  BRAND_FIT,
  BRAND_MIDDLE_MM,
  LOGO_BOX_MM,
  PHOTO_BAND_MM,
  PHOTO_FADE_FROM,
  PLATE_ABOVE_ADDRESS_MM,
  PLATE_MM,
  PLATE_PAPER_MM,
  PLATE_PAPER_RADIUS_MM,
  PLATE_RADIUS_MM,
  SIDE_MARGIN_MM,
  SLUG_MM,
  STACK_GAP_BELOW_MM,
  STACK_TOP_MM,
  TRACKING_EM,
  printPageMm,
} from '#/shared/domain/portal-print-kit-layout'
import { printKitPalette } from '#/shared/domain/portal-print-kit-palette'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import {
  mmToContainerWidth,
  previewAddress,
  previewPlateTopMm,
  previewWordmark,
} from './print-kit-art-layout'
import { PrintKitCropMarks } from './print-kit-crop-marks'
import { PrintKitStack } from './print-kit-stack'
import { printKitPreviewLabel } from './print-kit-state'

const PAGE = printPageMm(A6_WIDTH_MM, A6_HEIGHT_MM)
const MM_PER_POINT = 25.4 / 72
const FIELD_FONT = 'var(--font-guest-body)'
const DISPLAY_FONT = 'var(--font-guest-display)'

/** Millimetres on the page, as a share of the card's width. */
const u = (millimetres: number) => mmToContainerWidth(millimetres, PAGE.widthMm)
const pt = (points: number) => u(points * MM_PER_POINT)

type Props = Readonly<{
  piece: PrintKitPiece
  face: PrintFace
  look: PortalPrintKitView['look']
  /** The code as a picture, with its quiet zone drawn in; null while it is made. */
  codeUrl: string | null
  shortAddress: string
}>

const absolute = (style: CSSProperties): CSSProperties => ({
  position: 'absolute',
  ...style,
})

export function PrintKitArt({ piece, face, look, codeUrl, shortAddress }: Props) {
  const palette = printKitPalette(look.accentColour, look.fieldColour)
  const address = previewAddress(shortAddress)
  const plateTop = previewPlateTopMm(address)
  const addressTop = plateTop + PLATE_MM + PLATE_ABOVE_ADDRESS_MM
  const bleed = PRINT_KIT_BLEED_MM
  const fade = `linear-gradient(to bottom, transparent ${PHOTO_FADE_FROM * 100}%, ${palette.field} 100%)`
  const wash = (x: number, y: number, radius: number, colour: string) =>
    `radial-gradient(circle ${u(radius)} at ${u(x + bleed)} ${u(y + bleed)}, color-mix(in srgb, ${colour} 50%, transparent), transparent)`

  return (
    <div
      role="img"
      aria-label={printKitPreviewLabel(piece, face)}
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: `${PAGE.widthMm} / ${PAGE.heightMm}`,
        containerType: 'inline-size',
        fontFamily: FIELD_FONT,
      }}
    >
      <PrintKitCropMarks pageWidthMm={PAGE.widthMm} />
      <div
        style={absolute({
          left: u(SLUG_MM - bleed),
          top: u(SLUG_MM - bleed),
          width: u(A6_WIDTH_MM + 2 * bleed),
          height: u(A6_HEIGHT_MM + 2 * bleed),
          overflow: 'hidden',
          background: palette.field,
          boxShadow: '0 1px 2px rgba(16,17,21,.14), 0 16px 40px -12px rgba(16,17,21,.38)',
          color: palette.body,
        })}
      >
        {look.heroUrl !== null && (
          <>
            <img
              src={look.heroUrl}
              alt=""
              style={absolute({
                left: 0,
                top: 0,
                width: '100%',
                height: u(PHOTO_BAND_MM + bleed),
                objectFit: 'cover',
                objectPosition: `${(look.heroFocal?.x ?? 0.5) * 100}% ${(look.heroFocal?.y ?? 0.5) * 100}%`,
              })}
            />
            <div
              aria-hidden
              style={absolute({
                left: 0,
                top: 0,
                width: '100%',
                height: u(PHOTO_BAND_MM + bleed),
                background: `${fade}, rgba(0,0,0,.18)`,
              })}
            />
            <div
              aria-hidden
              style={absolute({
                left: 0,
                top: 0,
                width: '100%',
                height: u(29 + bleed),
                background: 'linear-gradient(to bottom, rgba(0,0,0,.6), transparent)',
              })}
            />
          </>
        )}
        <div
          aria-hidden
          style={absolute({
            inset: 0,
            background: `${wash(13, 128, 80, palette.warm)}, ${wash(100, 84, 60, palette.cool)}`,
          })}
        />
        <div
          style={absolute({
            left: u(bleed),
            top: u(bleed),
            width: u(A6_WIDTH_MM),
            height: u(A6_HEIGHT_MM),
          })}
        >
          <Brand look={look} />
          <div
            style={absolute({
              left: u(SIDE_MARGIN_MM),
              width: u(A6_WIDTH_MM - 2 * SIDE_MARGIN_MM),
              top: u(STACK_TOP_MM),
              height: u(plateTop - STACK_GAP_BELOW_MM - STACK_TOP_MM),
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
            })}
          >
            <PrintKitStack face={face} palette={palette} pt={pt} u={u} />
          </div>
          <Plate top={plateTop} codeUrl={codeUrl} />
          <div
            style={absolute({
              left: u(SIDE_MARGIN_MM),
              width: u(A6_WIDTH_MM - 2 * SIDE_MARGIN_MM),
              top: u(addressTop),
              textAlign: 'center',
              fontSize: pt(address.sizePt),
              lineHeight: 1.3,
              color: `rgba(255,255,255,${ADDRESS_OPACITY})`,
              whiteSpace: 'nowrap',
            })}
          >
            {address.lines.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function Brand({ look }: Readonly<{ look: PortalPrintKitView['look'] }>) {
  const place = absolute({
    left: 0,
    width: '100%',
    top: u(BRAND_MIDDLE_MM),
    transform: 'translateY(-50%)',
    textAlign: 'center',
  })
  if (look.logoUrl !== null) {
    return (
      <div style={place}>
        <img
          src={look.logoUrl}
          alt=""
          style={{
            display: 'inline-block',
            maxWidth: u(LOGO_BOX_MM.width),
            maxHeight: u(LOGO_BOX_MM.height),
            objectFit: 'contain',
          }}
        />
      </div>
    )
  }
  // A long name shrinks, then takes a second line, as it does in the file.
  const { lines, size } = previewWordmark(look.wordmark)
  return (
    <p
      style={{
        ...place,
        margin: 0,
        paddingLeft: `${TRACKING_EM.wordmark}em`,
        fontFamily: DISPLAY_FONT,
        fontWeight: 600,
        fontSize: pt(size),
        lineHeight: BRAND_FIT.wordmark.lineHeight,
        letterSpacing: `${TRACKING_EM.wordmark}em`,
        textTransform: 'uppercase',
        color: '#fff',
        whiteSpace: 'nowrap',
      }}
    >
      {lines.map((line) => (
        <span key={line} style={{ display: 'block' }}>
          {line}
        </span>
      ))}
    </p>
  )
}

function Plate({ top, codeUrl }: Readonly<{ top: number; codeUrl: string | null }>) {
  return (
    <div
      aria-hidden
      style={absolute({
        left: u((A6_WIDTH_MM - PLATE_MM) / 2),
        top: u(top),
        width: u(PLATE_MM),
        height: u(PLATE_MM),
        borderRadius: u(PLATE_RADIUS_MM),
        background: 'rgba(255,255,255,.1)',
        border: `${u(0.25)} solid rgba(255,255,255,.2)`,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      })}
    >
      {codeUrl === null ? (
        <div
          style={{
            width: u(PLATE_PAPER_MM),
            height: u(PLATE_PAPER_MM),
            borderRadius: u(PLATE_PAPER_RADIUS_MM),
            background: '#F6F1E6',
          }}
        />
      ) : (
        <img
          src={codeUrl}
          alt=""
          style={{
            display: 'block',
            width: u(PLATE_PAPER_MM),
            height: u(PLATE_PAPER_MM),
            borderRadius: u(PLATE_PAPER_RADIUS_MM),
          }}
        />
      )}
    </div>
  )
}
