// A card's back page as the Share tab's preview draws it, laid out once: the
// logo or the wordmark and the property's name by the planner the PDF uses
// (`previewFinalBackLayout`), on the front's colours and, for Immersive, the
// front's ground and washes (`printFinalBackArt`). It follows its front: the plate
// decision and the palette are the front's, so the two sides agree. The sheet's
// reverse draws it in every cell, with the front's bleed.

import { useMemo } from 'react'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import type { PrintFinalFace } from '#/shared/domain/portal-print-final'
import {
  printFinalBackArt,
  type PrintFinalArt,
} from '#/shared/domain/portal-print-final-art'
import type { PrintFinalBackLayout } from '#/shared/domain/portal-print-final-back'
import type { PrintFinalColours } from '#/shared/domain/portal-print-final-colours'
import type { PrintFinalBleed } from '#/shared/domain/portal-print-final-layers'
import { previewFinalBackLayout } from './print-final-face-layout'
import type { PrintFinalDrawnFace } from './use-print-final-drawn-face'
import { usePreviewFinalLogo } from './use-print-final-pictures'

export type PrintFinalDrawnBack = Readonly<{
  layout: PrintFinalBackLayout
  colours: PrintFinalColours
  /** The Immersive ground and washes; null on Paper. */
  art: PrintFinalArt | null
  /** The ground under it, for the container behind the art. */
  ground: string | null
}>

type Input = Readonly<{
  face: PrintFinalFace
  look: PortalPrintKitView['look']
  /** The front, laid out: the back takes its colours, its palette and its plate decision. */
  front: PrintFinalDrawnFace
  /** A back page is asked for: without it nothing is laid out. */
  enabled: boolean
  /** On a sheet, how far the Immersive ground runs past the trim. */
  bleed?: PrintFinalBleed
}>

export function usePrintFinalDrawnBack(input: Input): PrintFinalDrawnBack | null {
  const { face, look, front, enabled, bleed } = input
  const logo = usePreviewFinalLogo(look.logoUrl)
  const aspect = logo.status === 'read' ? logo.value.aspect : null
  return useMemo((): PrintFinalDrawnBack | null => {
    if (!enabled) return null
    const immersive = front.look === 'immersive'
    const layout = previewFinalBackLayout({
      face,
      look,
      logoAspect: aspect,
      onPlate: immersive && front.laid.logoOnPlate,
    })
    if (!immersive) {
      return { layout, colours: front.colours, art: null, ground: null }
    }
    const { palette, colours } = front.laid
    return {
      layout,
      colours,
      art: printFinalBackArt(layout.plan, palette, bleed),
      ground: palette.ground,
    }
  }, [enabled, face, look, front, aspect, bleed])
}
