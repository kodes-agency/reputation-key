// The art under a final Immersive face in the Share tab's preview (final design
// spec §6), drawn in CSS from the plan the PDF draws (`printFinalArt`): the
// ground and its washes as radial gradients, the photo cropped as the file
// crops it and faded by a mask, the scrims as gradients of the scrim ink, the
// no-photo arch, the grain blended as overlay and a tent's fold strip. Each
// ramp's stops become a gradient's stops at the same points.

import { useId, type CSSProperties } from 'react'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import { parseHexColour } from '#/shared/domain/portal-field-colour'
import type { PrintFinalArt } from '#/shared/domain/portal-print-final-art'
import {
  printFinalPhotoCrop,
  type PrintFinalFraming,
} from '#/shared/domain/portal-print-final-framing'
import type {
  PrintFinalBleed,
  PrintFinalRamp,
  PrintFinalWash,
} from '#/shared/domain/portal-print-final-layers'
import type { PrintFinalBox } from '#/shared/domain/portal-print-final-measures'
import { PRINT_FINAL_SCRIM_INK } from '#/shared/domain/portal-print-final-photo-sample'
import type { PointsToLength } from './print-kit-code-block-layout'
import type { PreviewFinalPhoto } from './use-print-final-pictures'

const rgba = (channels: readonly number[], alpha: number) =>
  `rgba(${channels.slice(0, 3).join(', ')}, ${Number(alpha.toFixed(4))})`

const rgbaOf = (hex: string, alpha: number) =>
  rgba(parseHexColour(hex) ?? [0, 0, 0], alpha)

const placed = (pt: PointsToLength, box: PrintFinalBox): CSSProperties => ({
  position: 'absolute',
  left: pt(box.leftPt),
  top: pt(box.topPt),
  width: pt(box.rightPt - box.leftPt),
  height: pt(box.bottomPt - box.topPt),
})

/** A ramp as a CSS gradient over `box`, each stop at its point, painted in `colour` at the stop's alpha. */
function rampGradient(
  ramp: PrintFinalRamp,
  box: PrintFinalBox,
  colour: readonly number[],
  pt: PointsToLength,
): string {
  const start = ramp.axis === 'x' ? box.leftPt : box.topPt
  const stops = ramp.stops.map(
    (stop) => `${rgba(colour, stop.alpha)} ${pt(stop.atPt - start)}`,
  )
  return `linear-gradient(${ramp.axis === 'x' ? 'to right' : 'to bottom'}, ${stops.join(', ')})`
}

const BLACK = [0, 0, 0] as const

function washGradient(wash: PrintFinalWash, pt: PointsToLength): string {
  return `radial-gradient(${pt(wash.rxPt)} ${pt(wash.ryPt)} at ${pt(wash.xPt)} ${pt(wash.yPt)}, ${rgbaOf(wash.colour, wash.alpha)} 0%, ${rgbaOf(wash.colour, 0)} ${wash.fade * 100}%)`
}

type PhotoProps = Readonly<{
  photo: NonNullable<PrintFinalArt['photo']>
  read: PreviewFinalPhoto
  url: string
  focal: Readonly<{ x: number; y: number }>
  framing: PrintFinalFraming
  pt: PointsToLength
}>

/** The photo: the part of it the file crops, scaled to cover the cover box, shown in its box under its fade. */
function Photo({ photo, read, url, focal, framing, pt }: PhotoProps) {
  const { box, cover } = photo
  const coverWidth = cover.rightPt - cover.leftPt
  const crop = printFinalPhotoCrop(
    read.pixels,
    { widthPt: coverWidth, heightPt: cover.bottomPt - cover.topPt },
    focal,
    framing,
  )
  const scale = coverWidth / crop.widthPx
  const mask = rampGradient(photo.fade, box, BLACK, pt)
  return (
    <div
      style={{
        ...placed(pt, box),
        overflow: 'hidden',
        maskImage: mask,
        WebkitMaskImage: mask,
      }}
    >
      <img
        src={url}
        alt=""
        style={{
          position: 'absolute',
          left: pt(cover.leftPt - box.leftPt - crop.leftPx * scale),
          top: pt(cover.topPt - box.topPt - crop.topPx * scale),
          width: pt(read.pixels.widthPx * scale),
          height: pt(read.pixels.heightPx * scale),
          maxWidth: 'none',
          display: 'block',
        }}
      />
    </div>
  )
}

function Arch({
  arch,
  pt,
}: Readonly<{ arch: NonNullable<PrintFinalArt['arch']>; pt: PointsToLength }>) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 100 140"
      preserveAspectRatio="none"
      style={{ ...placed(pt, arch.box), overflow: 'visible' }}
    >
      <path
        d="M2 140 V50 A48 48 0 0 1 98 50 V140"
        fill="none"
        stroke={rgbaOf(arch.colour, arch.opacity)}
        vectorEffect="non-scaling-stroke"
        style={{ strokeWidth: pt(arch.strokePt) }}
      />
    </svg>
  )
}

/** The boards' film grain: fractal noise, desaturated, blended as overlay. */
function Grain({ opacity }: Readonly<{ opacity: number }>) {
  const id = `print-grain-${useId().replace(/:/gu, '')}`
  return (
    <svg
      aria-hidden
      width="10"
      height="10"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        opacity,
        mixBlendMode: 'overlay',
      }}
    >
      <filter id={id}>
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.85"
          numOctaves={2}
          stitchTiles="stitch"
        />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="100%" height="100%" filter={`url(#${id})`} />
    </svg>
  )
}

type Props = Readonly<{
  art: PrintFinalArt
  /** The photo as read, with where it lives; null with no photo. */
  photo: Readonly<{ read: PreviewFinalPhoto; url: string }> | null
  look: PortalPrintKitView['look']
  framing: PrintFinalFraming
  /** On a sheet, how far the art runs past the trim; it is clipped there. Absent: at the trim. */
  bleed?: PrintFinalBleed
  pt: PointsToLength
}>

/** The art's clip (the trim, or the trim and its bleed) and the trim inside it, where the face's origin stays. */
function clipOf(bleed: PrintFinalBleed | undefined, pt: PointsToLength) {
  if (bleed === undefined) {
    return { outer: { inset: 0 }, origin: { inset: 0 } }
  }
  return {
    outer: {
      left: pt(-bleed.leftPt),
      top: pt(-bleed.topPt),
      right: pt(-bleed.rightPt),
      bottom: pt(-bleed.bottomPt),
    },
    origin: {
      left: pt(bleed.leftPt),
      top: pt(bleed.topPt),
      right: pt(bleed.rightPt),
      bottom: pt(bleed.bottomPt),
    },
  }
}

export function PrintFinalImmersiveArt({ art, photo, look, framing, bleed, pt }: Props) {
  const washes = art.washes.map((wash) => washGradient(wash, pt))
  const clip = clipOf(bleed, pt)
  return (
    <div aria-hidden style={{ position: 'absolute', ...clip.outer, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', ...clip.origin }}>
        <div
          style={{
            ...placed(pt, art.groundBox),
            background: [...washes, art.ground].join(', '),
          }}
        />
        {art.photo !== null && photo !== null ? (
          <Photo
            photo={art.photo}
            read={photo.read}
            url={photo.url}
            focal={look.heroFocal ?? { x: 0.5, y: 0.5 }}
            framing={framing}
            pt={pt}
          />
        ) : null}
        {art.scrims.map((scrim) => {
          const [down, across] = scrim.ramps
          const mask =
            across === undefined ? undefined : rampGradient(across, scrim.box, BLACK, pt)
          return (
            <div
              key={`${scrim.box.topPt}:${scrim.box.bottomPt}`}
              style={{
                ...placed(pt, scrim.box),
                background:
                  down === undefined
                    ? 'none'
                    : rampGradient(down, scrim.box, PRINT_FINAL_SCRIM_INK, pt),
                ...(mask === undefined ? {} : { maskImage: mask, WebkitMaskImage: mask }),
              }}
            />
          )
        })}
        {art.arch === null ? null : <Arch arch={art.arch} pt={pt} />}
        <Grain opacity={art.grainOpacity} />
        {art.foldStrip === null ? null : (
          <div
            style={{ ...placed(pt, art.foldStrip.box), background: art.foldStrip.colour }}
          />
        )}
      </div>
    </div>
  )
}
