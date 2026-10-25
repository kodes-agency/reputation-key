// The print shop's page under the face in the Share tab's preview (final design
// spec §10.3 and §11.7): "Your file · page 1 of 1", the page the PDF makes with
// its print margin, its crop marks where they are on, and a line on what it is.
// It stands where the manager's own printer's first sheet stands, and follows
// the Front and Back control the face above it follows.

import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import {
  printFinalShopPageCaption,
  printFinalShopPageHeading,
} from '#/shared/domain/portal-print-final-shop-copy'
import { PrintFinalShopArt } from './print-final-shop-art'
import type { PrintFinalTile } from '#/shared/domain/portal-print-final-code'
import type { PrintFinalState } from './use-print-final'

const CSS_PX_PER_PT = 96 / 72

type Props = Readonly<{
  final: PrintFinalState
  view: PortalPrintKitView
  tile: PrintFinalTile
  /** The back page is on show. */
  back: boolean
  /** The tallest the page is drawn, in CSS pixels. */
  maxHeightPx: number
}>

export function PrintFinalShopPreview({ final, view, tile, back, maxHeightPx }: Props) {
  const { print, shopPage: page } = final
  if (print === null || page === null) return null
  const heading = printFinalShopPageHeading({
    backPage: print.backPage,
    side: back ? 'back' : 'front',
  })
  const widthPx = Math.min(
    page.widthPt * CSS_PX_PER_PT,
    (maxHeightPx * page.widthPt) / page.heightPt,
  )
  return (
    <div className="mt-1.5 flex flex-col gap-2">
      <p className="text-[13px] font-medium">
        Your file <span className="font-normal text-muted-foreground">· {heading}</span>
      </p>
      <div
        style={{
          width: `min(100%, ${Number(widthPx.toFixed(1))}px)`,
          boxShadow: '0 0 0 1px var(--border)',
          borderRadius: 2,
        }}
      >
        <PrintFinalShopArt
          page={page}
          face={{ face: final.face, blocks: final.blocks, look: view.look, tile }}
          codeUrl={final.code.url}
          back={back}
          label={`Print-shop file, ${heading}`}
        />
      </div>
      <p className="text-xs text-pretty text-muted-foreground">
        {printFinalShopPageCaption(page, print.backPage)}
      </p>
    </div>
  )
}
