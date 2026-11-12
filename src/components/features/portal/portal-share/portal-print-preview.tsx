// The print's preview (design spec §11.7, the boards
// share-desktop-light and share-desktop-dark), drawn in the browser from the
// geometry the PDF draws: the face in the chosen orientation, "shown smaller",
// the soft-photo notice for its photo box, and the first office sheet with its
// marks, or for a print shop its file's page. Changing the orientation redraws both. A card with a back page has a
// Front and Back control: Back draws the back face, and the sheet's reverse with
// the cells mirrored. On a desktop it is the sticky column beside the section; on
// a phone it opens as a sheet over the page (`PortalPrintPhoneBar`), which
// hands in its own orientation control.

import { useState, type ReactNode } from 'react'
import { Skeleton } from '#/components/ui/skeleton'
import type { PortalPrintKitView } from '#/contexts/portal/application/portal-management-contracts'
import { printBackCaption, type PrintSide } from '#/shared/domain/portal-print-back-copy'
import {
  printFaceCaption,
  printPhotoNotice,
  printSheetCaption,
  printSheetHeading,
} from '#/shared/domain/portal-print-how-to'
import type { PrintTile } from '#/shared/domain/portal-print-code'
import { printLiveArea } from '#/shared/domain/portal-print-measures'
import {
  printPhotoBox,
  printPhotoDpi,
  printPhotoPixelsFor,
} from '#/shared/domain/portal-print-photo'
import { GUEST_FONT_STYLESHEET } from '#/shared/font-sets'
import { PrintDrawnBackArt } from './print-back-art'
import { PrintDrawnFaceArt } from './print-face-art'
import { PrintPhotoNotice } from './print-photo-notice'
import { PrintSheetArt } from './print-sheet-art'
import { PrintShopPreview } from './print-shop-preview'
import { PrintSideControl } from './print-side-control'
import { ptToContainerWidth } from './print-kit-paper-art-layout'
import { usePrintDrawnBack, type PrintDrawnBack } from './use-print-drawn-back'
import { usePrintDrawnFace, type PrintDrawnFace } from './use-print-drawn-face'
import { PrintEveryCard } from './print-every-card'
import type { PrintState } from './use-print'

/** The tallest the face is drawn, in CSS pixels: the board's 380 beside the section, smaller in the phone's sheet. */
const FACE_MAX_HEIGHT_PX = { column: 380, sheet: 260 } as const
const CSS_PX_PER_PT = 96 / 72

/** The photo's resolution on this face, floored; null when the face shows no photo. */
function photoDpiOf(
  drawn: PrintDrawnFace,
  look: PortalPrintKitView['look'],
): Readonly<{ dpi: number; sharp: { widthPx: number; heightPx: number } }> | null {
  if (drawn.look !== 'immersive' || look.heroUrl === null || look.heroSize === null) {
    return null
  }
  const box = printPhotoBox(drawn.laid.layout.plan)
  const pixels = { widthPx: look.heroSize.width, heightPx: look.heroSize.height }
  return {
    dpi: printPhotoDpi(pixels, box),
    sharp: printPhotoPixelsFor(box, 200),
  }
}

type Props = Readonly<{
  printState: PrintState
  view: PortalPrintKitView | null
  placement: 'column' | 'sheet'
  /** The portal whose Look section changes the photo, with its property; absent: no link. */
  propertyId?: string
  portalId?: string
  /** Under the face in the phone's sheet: the orientation control. */
  controls?: ReactNode
}>

function Face({
  printState,
  drawn,
  back,
  look,
  maxHeightPx,
}: Readonly<{
  printState: PrintState
  drawn: PrintDrawnFace
  /** Show the back page instead of the front. */
  back: PrintDrawnBack | null
  look: PortalPrintKitView['look']
  maxHeightPx: number
}>) {
  const { widthPt, heightPt } = printLiveArea(printState.face)
  const widthPx = widthPt * CSS_PX_PER_PT
  const fitted = Math.min(widthPx, (maxHeightPx * widthPt) / heightPt)
  const pt = (points: number) => ptToContainerWidth(points, widthPt)
  return (
    <div
      role="img"
      aria-label={`${printState.face.orientation === 'upright' ? 'Upright' : 'Wide'} ${back === null ? 'face' : 'back'}, shown smaller`}
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
        <PrintDrawnFaceArt
          drawn={drawn}
          look={look}
          codeUrl={printState.code.url}
          pt={pt}
        />
      ) : (
        <PrintDrawnBackArt drawn={back} look={look} pt={pt} />
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

type ReadyProps = Props & Readonly<{ view: PortalPrintKitView; tile: PrintTile }>

/** The first office sheet, or its reverse where the Back side is on show. */
function SheetPreview({
  printState,
  view,
  tile,
  back,
}: Pick<ReadyProps, 'printState' | 'view' | 'tile'> & Readonly<{ back: boolean }>) {
  const { print, count, sheet } = printState
  if (print === null || count === null) return null
  const face = { face: printState.face, blocks: printState.blocks, look: view.look, tile }
  const heading = printSheetHeading(print, count.sheets, back)
  return (
    <div className="mt-1.5 flex flex-col gap-2">
      <p className="text-[13px] font-medium">
        Your sheet <span className="font-normal text-muted-foreground">· {heading}</span>
      </p>
      <div style={{ boxShadow: '0 0 0 1px var(--border)', borderRadius: 2 }}>
        <PrintSheetArt
          sheet={sheet}
          filled={Math.min(print.perSheet, count.pieces)}
          face={face}
          codeUrl={printState.code.url}
          tilePt={tile.tilePt}
          label={`Your sheet, ${heading}`}
          back={back}
        />
      </div>
      <p className="text-xs text-pretty text-muted-foreground">
        {printSheetCaption(print, print.perSheet, back)}
      </p>
    </div>
  )
}

function Ready({
  printState,
  view,
  placement,
  propertyId,
  portalId,
  controls,
  tile,
}: ReadyProps) {
  const { print } = printState
  const [chosenSide, setSide] = useState<PrintSide>('front')
  const faceInput = {
    face: printState.face,
    blocks: printState.blocks,
    look: view.look,
    tile,
  }
  const drawn = usePrintDrawnFace(faceInput)
  const hasBack = print?.backPage === true
  const drawnBack = usePrintDrawnBack({
    face: printState.face,
    look: view.look,
    front: drawn,
    enabled: hasBack,
  })
  if (print === null || printState.count === null) return null
  // A back page turned off while its side is on show leaves the front.
  const side = hasBack ? chosenSide : 'front'
  const showBack = side === 'back' && drawnBack !== null
  const photo = photoDpiOf(drawn, view.look)
  const sharp = photo !== null && photo.dpi >= 200 ? photo.dpi : null
  return (
    <>
      {hasBack && (
        <div className="flex">
          <PrintSideControl side={side} onChange={setSide} />
        </div>
      )}
      <Face
        printState={printState}
        drawn={drawn}
        back={showBack ? drawnBack : null}
        look={view.look}
        maxHeightPx={FACE_MAX_HEIGHT_PX[placement]}
      />
      <Caption
        {...(showBack ? printBackCaption(print) : printFaceCaption(print, sharp))}
      />
      {!showBack && (
        <PrintPhotoNotice
          notice={photo === null ? null : printPhotoNotice(photo.dpi, photo.sharp)}
          propertyId={propertyId}
          portalId={portalId}
        />
      )}
      {controls}
      <PrintEveryCard words={printState.words} print={print} />
      {print.printer === 'my_printer' ? (
        <SheetPreview printState={printState} view={view} tile={tile} back={showBack} />
      ) : (
        <PrintShopPreview
          printState={printState}
          view={view}
          tile={tile}
          back={showBack}
          maxHeightPx={FACE_MAX_HEIGHT_PX[placement]}
        />
      )}
    </>
  )
}

export function PortalPrintPreview(props: Props) {
  const { printState, view, placement } = props
  const tile = printState.tile
  return (
    <section
      aria-labelledby={placement === 'column' ? 'print-preview-heading' : undefined}
      className="flex flex-col gap-3"
    >
      <link rel="stylesheet" href={GUEST_FONT_STYLESHEET} precedence="default" />
      {placement === 'column' && (
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="print-preview-heading" className="text-sm font-semibold">
            Preview
          </h2>
          <span className="text-xs text-muted-foreground">
            {printState.words.isOwn ? 'Updates as you type' : 'Your live photo and words'}
          </span>
        </div>
      )}
      {view === null || printState.print === null ? (
        <Skeleton className="w-full" style={{ aspectRatio: '4 / 3' }} />
      ) : tile === null ? (
        <p className="text-sm text-muted-foreground">{printState.refusal}</p>
      ) : (
        <Ready {...props} view={view} tile={tile} />
      )}
    </section>
  )
}
