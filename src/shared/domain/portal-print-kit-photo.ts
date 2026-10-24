// The property's photo where an Immersive print shows it, and the resolution it
// prints at there. Pure and shared: the PDF measures the crop it makes with
// these, and the Share tab measures the notice it shows ("your photo is small
// for print") with the same ones, so the two cannot disagree about a photo.
//
// A photo covers its area, as the preview and the guest page place it: it is
// enlarged until it fills the area and what overflows is cropped, so the
// resolution it prints at is the lesser of its two sides' pixels per printed
// inch. Areas are in points, with the bleed the face has where the page puts it.

import type { PanelBleed } from './portal-print-kit-sheet-parts'
import type { CardPlan } from './portal-print-kit-card'
import { printedDpi } from './portal-print-kit-measures'
import type { TentPlan } from './portal-print-kit-tent'

/** A photo's own size, as stored. */
export type PhotoPixels = Readonly<{ widthPx: number; heightPx: number }>

/** The area a face shows the photo in, bleed included, in points. */
export type PhotoArea = Readonly<{ widthPt: number; heightPt: number }>

/**
 * The dots per inch a photo prints at when it covers `area`: the lesser of
 * its width over the area's width and its height over the area's height, since
 * the side that is short of pixels is the side that gets enlarged.
 */
export const photoPrintDpi = (photo: PhotoPixels, area: PhotoArea): number =>
  Math.min(
    printedDpi(photo.widthPx, area.widthPt),
    printedDpi(photo.heightPx, area.heightPt),
  )

/** A card's band with its bleed: across the top, and into the bleed on the top and each side that bleeds. Null on a card with no band. */
export const cardBandArea = (
  plan: Pick<CardPlan, 'widthPt' | 'bandPt'>,
  bleed: PanelBleed,
): PhotoArea | null =>
  plan.bandPt === null
    ? null
    : {
        widthPt: plan.widthPt + bleed.leftPt + bleed.rightPt,
        heightPt: plan.bandPt + bleed.topPt,
      }

/** A small tent's photo panel with its bleed: down the left, into the bleed on the left, top and foot. Null on a tent with no panel. */
export const tentPanelArea = (
  plan: Pick<TentPlan, 'panelPt' | 'heightPt'>,
  bleed: PanelBleed,
): PhotoArea | null =>
  plan.panelPt === null
    ? null
    : {
        widthPt: plan.panelPt + bleed.leftPt,
        heightPt: plan.heightPt + bleed.topPt + bleed.bottomPt,
      }
