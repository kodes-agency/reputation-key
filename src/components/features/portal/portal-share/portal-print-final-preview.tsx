// The final print's preview (final design spec §11.7, the boards
// share-desktop-light and share-desktop-dark), drawn in the browser from the
// geometry the PDF draws: the face in the chosen orientation, "shown smaller",
// the soft-photo notice for its photo box, and the first office sheet with its
// marks, or for a print shop its file's page. Changing the orientation redraws both. A card with a back page has a
// Front and Back control: Back draws the back face, and the sheet's reverse with
// the cells mirrored. On a desktop it is the sticky column beside the section; on
// a phone it opens as a sheet over the page (`PortalPrintFinalPhoneBar`), which
// hands in its own orientation control.

import { useState, type ReactNode } from 'react'
import { Skeleton } from '#/components/ui/skeleton'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import {
  printFinalBackCaption,
  type PrintFinalSide,
} from '#/shared/domain/portal-print-final-back-copy'
import {
  printFinalFaceCaption,
  printFinalPhotoNotice,
  printFinalSheetCaption,
  printFinalSheetHeading,
} from '#/shared/domain/portal-print-final-how-to'
import type { PrintFinalTile } from '#/shared/domain/portal-print-final-code'
import { printFinalLiveArea } from '#/shared/domain/portal-print-final-measures'
import {
  printFinalPhotoBox,
  printFinalPhotoDpi,
  printFinalPhotoPixelsFor,
} from '#/shared/domain/portal-print-final-photo'
import { GUEST_FONT_STYLESHEET } from '#/shared/font-sets'
import { PrintFinalDrawnBackArt } from './print-final-back-art'
import { PrintFinalDrawnFaceArt } from './print-final-face-art'
import { PrintFinalPhotoNotice } from './print-final-photo-notice'
import { PrintFinalSheetArt } from './print-final-sheet-art'
import { PrintFinalShopPreview } from './print-final-shop-preview'
import { PrintFinalSideControl } from './print-final-side-control'
import { ptToContainerWidth } from './print-kit-paper-art-layout'
import {
  usePrintFinalDrawnBack,
  type PrintFinalDrawnBack,
} from './use-print-final-drawn-back'
import {
  usePrintFinalDrawnFace,
  type PrintFinalDrawnFace,
} from './use-print-final-drawn-face'
import { PrintFinalEveryCard } from './print-final-every-card'
import type { PrintFinalState } from './use-print-final'

/** The tallest the face is drawn, in CSS pixels: the board's 380 beside the section, smaller in the phone's sheet. */
const FACE_MAX_HEIGHT_PX = { column: 380, sheet: 260 } as const
const CSS_PX_PER_PT = 96 / 72

/** The photo's resolution on this face, floored; null when the face shows no photo. */
function photoDpiOf(
  drawn: PrintFinalDrawnFace,
  look: PortalPrintKitView['look'],
): Readonly<{ dpi: number; sharp: { widthPx: number; heightPx: number } }> | null {
  if (drawn.look !== 'immersive' || look.heroUrl === null || look.heroSize === null) {
    return null
  }
  const box = printFinalPhotoBox(drawn.laid.layout.plan)
  const pixels = { widthPx: look.heroSize.width, heightPx: look.heroSize.height }
  return {
    dpi: printFinalPhotoDpi(pixels, box),
    sharp: printFinalPhotoPixelsFor(box, 200),
  }
}

type Props = Readonly<{
  final: PrintFinalState
  view: PortalPrintKitView | null
  placement: 'column' | 'sheet'
  /** The property whose Photo and colours page changes the photo. */
  propertyId?: string
  /** Under the face in the phone's sheet: the orientation control. */
  controls?: ReactNode
}>

function Face({
  final,
  drawn,
  back,
  look,
  maxHeightPx,
}: Readonly<{
  final: PrintFinalState
  drawn: PrintFinalDrawnFace
  /** Show the back page instead of the front. */
  back: PrintFinalDrawnBack | null
  look: PortalPrintKitView['look']
  maxHeightPx: number
}>) {
  const { widthPt, heightPt } = printFinalLiveArea(final.face)
  const widthPx = widthPt * CSS_PX_PER_PT
  const fitted = Math.min(widthPx, (maxHeightPx * widthPt) / heightPt)
  const pt = (points: number) => ptToContainerWidth(points, widthPt)
  return (
    <div
      role="img"
      aria-label={`${final.face.orientation === 'upright' ? 'Upright' : 'Wide'} ${back === null ? 'face' : 'back'}, shown smaller`}
      style={{
        width: `min(100%, ${Number(fitted.toFixed(1))}px)`,
        aspectRatio: `${widthPt} / ${heightPt}`,
        containerType: 'inline-size',
        boxShadow: '0 0 0 1px var(--border), 0 10px 30px rgb(0 0 0 / 0.14)',
        borderRadius: 2,
        overflow: 'hidden',
      }}
    >
      {back === null ? (
        <PrintFinalDrawnFaceArt
          drawn={drawn}
          look={look}
          codeUrl={final.code.url}
          pt={pt}
        />
      ) : (
        <PrintFinalDrawnBackArt drawn={back} look={look} pt={pt} />
      )}
    </div>
  )
}

function Caption({ lead, rest }: Readonly<{ lead: string; rest: string }>) {
  return (
    <p className="text-xs text-pretty text-muted-foreground">
      <strong className="font-semibold text-foreground">{lead}</strong>
      {rest}
    </p>
  )
}

type ReadyProps = Props & Readonly<{ view: PortalPrintKitView; tile: PrintFinalTile }>

/** The first office sheet, or its reverse where the Back side is on show. */
function SheetPreview({
  final,
  view,
  tile,
  back,
}: Pick<ReadyProps, 'final' | 'view' | 'tile'> & Readonly<{ back: boolean }>) {
  const { print, count, sheet } = final
  if (print === null || count === null) return null
  const face = { face: final.face, blocks: final.blocks, look: view.look, tile }
  const heading = printFinalSheetHeading(print, count.sheets, back)
  return (
    <div className="mt-1.5 flex flex-col gap-2">
      <p className="text-[13px] font-medium">
        Your sheet <span className="font-normal text-muted-foreground">· {heading}</span>
      </p>
      <div style={{ boxShadow: '0 0 0 1px var(--border)', borderRadius: 2 }}>
        <PrintFinalSheetArt
          sheet={sheet}
          filled={Math.min(print.perSheet, count.pieces)}
          face={face}
          codeUrl={final.code.url}
          tilePt={tile.tilePt}
          label={`Your sheet, ${heading}`}
          back={back}
        />
      </div>
      <p className="text-xs text-pretty text-muted-foreground">
        {printFinalSheetCaption(print, print.perSheet, back)}
      </p>
    </div>
  )
}

function Ready({ final, view, placement, propertyId, controls, tile }: ReadyProps) {
  const { print } = final
  const [chosenSide, setSide] = useState<PrintFinalSide>('front')
  const faceInput = { face: final.face, blocks: final.blocks, look: view.look, tile }
  const drawn = usePrintFinalDrawnFace(faceInput)
  const hasBack = print?.backPage === true
  const drawnBack = usePrintFinalDrawnBack({
    face: final.face,
    look: view.look,
    front: drawn,
    enabled: hasBack,
  })
  if (print === null || final.count === null) return null
  // A back page turned off while its side is on show leaves the front.
  const side = hasBack ? chosenSide : 'front'
  const showBack = side === 'back' && drawnBack !== null
  const photo = photoDpiOf(drawn, view.look)
  const sharp = photo !== null && photo.dpi >= 200 ? photo.dpi : null
  return (
    <>
      {hasBack && (
        <div className="flex">
          <PrintFinalSideControl side={side} onChange={setSide} />
        </div>
      )}
      <Face
        final={final}
        drawn={drawn}
        back={showBack ? drawnBack : null}
        look={view.look}
        maxHeightPx={FACE_MAX_HEIGHT_PX[placement]}
      />
      <Caption
        {...(showBack
          ? printFinalBackCaption(print)
          : printFinalFaceCaption(print, sharp))}
      />
      {!showBack && (
        <PrintFinalPhotoNotice
          notice={photo === null ? null : printFinalPhotoNotice(photo.dpi, photo.sharp)}
          propertyId={propertyId}
        />
      )}
      {controls}
      <PrintFinalEveryCard words={final.words} print={print} />
      {print.printer === 'my_printer' ? (
        <SheetPreview final={final} view={view} tile={tile} back={showBack} />
      ) : (
        <PrintFinalShopPreview
          final={final}
          view={view}
          tile={tile}
          back={showBack}
          maxHeightPx={FACE_MAX_HEIGHT_PX[placement]}
        />
      )}
    </>
  )
}

export function PortalPrintFinalPreview(props: Props) {
  const { final, view, placement } = props
  const tile = final.tile
  return (
    <section
      aria-labelledby={placement === 'column' ? 'print-final-preview-heading' : undefined}
      className="flex flex-col gap-3"
    >
      <link rel="stylesheet" href={GUEST_FONT_STYLESHEET} precedence="default" />
      {placement === 'column' && (
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="print-final-preview-heading" className="text-sm font-semibold">
            Preview
          </h2>
          <span className="text-xs text-muted-foreground">
            {final.words.isOwn ? 'Updates as you type' : 'Your live photo and words'}
          </span>
        </div>
      )}
      {view === null || final.print === null ? (
        <Skeleton className="w-full" style={{ aspectRatio: '4 / 3' }} />
      ) : tile === null ? (
        <p className="text-sm text-muted-foreground">{final.refusal}</p>
      ) : (
        <Ready {...props} view={view} tile={tile} />
      )}
    </section>
  )
}
