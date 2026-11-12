// A card's back page as the Share tab's preview draws it, laid out once: the
// logo or the wordmark and the property's name by the planner the PDF uses
// (`previewBackLayout`), on the front's colours and, for Immersive, the
// front's ground and washes (`printBackArt`). It follows its front: the plate
// decision and the palette are the front's, so the two sides agree. The sheet's
// reverse draws it in every cell, with the front's bleed.

import { useMemo } from 'react'
import type { PortalPrintKitView } from '#/contexts/portal/application/portal-management-contracts'
import type { PrintFace } from '#/shared/domain/portal-print'
import { printBackArt, type PrintArt } from '#/shared/domain/portal-print-art'
import type { PrintBackLayout } from '#/shared/domain/portal-print-back'
import type { PrintColours } from '#/shared/domain/portal-print-colours'
import type { PrintBleed } from '#/shared/domain/portal-print-layers'
import { previewBackLayout } from './print-face-layout'
import type { PrintDrawnFace } from './use-print-drawn-face'
import { usePreviewLogo } from './use-print-pictures'

export type PrintDrawnBack = Readonly<{
  layout: PrintBackLayout
  colours: PrintColours
  /** The Immersive ground and washes; null on Paper. */
  art: PrintArt | null
  /** The ground under it, for the container behind the art. */
  ground: string | null
}>

type Input = Readonly<{
  face: PrintFace
  look: PortalPrintKitView['look']
  /** The front, laid out: the back takes its colours, its palette and its plate decision. */
  front: PrintDrawnFace
  /** A back page is asked for: without it nothing is laid out. */
  enabled: boolean
  /** On a sheet, how far the Immersive ground runs past the trim. */
  bleed?: PrintBleed
}>

export function usePrintDrawnBack(input: Input): PrintDrawnBack | null {
  const { face, look, front, enabled, bleed } = input
  const logo = usePreviewLogo(look.logoUrl)
  const aspect = logo.status === 'read' ? logo.value.aspect : null
  return useMemo((): PrintDrawnBack | null => {
    if (!enabled) return null
    const immersive = front.look === 'immersive'
    const layout = previewBackLayout({
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
      art: printBackArt(layout.plan, palette, bleed),
      ground: palette.ground,
    }
  }, [enabled, face, look, front, aspect, bleed])
}
