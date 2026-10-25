// A final face in the Share tab's preview (final design spec §2 to §8), drawn
// from the layout the PDF draws from (`usePrintFinalDrawnFace`). Paper is plain
// paper with the words, marks and code on it (`PrintFinalFaceParts`); Immersive
// paints its photo fade under them (`PrintFinalImmersiveArt`). While the photo
// decodes, an Immersive face shows its words on the plain ground; a photo the
// browser cannot read is drawn as the no-photo ground.
//
// Inline styles on purpose, as the rest of the print preview's: the first-paint
// stylesheet is built by scanning `src/` for class names, and a measure this
// specific would land in every page's.

import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import {
  PRINT_FINAL_DEFAULT_FRAMING,
  type PrintFinalFraming,
} from '#/shared/domain/portal-print-final-framing'
import type { PrintFinalBleed } from '#/shared/domain/portal-print-final-layers'
import { PRINT_KIT_PAPER } from '#/shared/domain/portal-print-kit-palette'
import type { PointsToLength } from './print-kit-code-block-layout'
import { PrintFinalFaceParts } from './print-final-face-parts'
import { PrintFinalImmersiveArt } from './print-final-immersive-art'
import {
  usePrintFinalDrawnFace,
  type PrintFinalDrawnFace,
  type PrintFinalFaceInput,
} from './use-print-final-drawn-face'

const ignoreAspect = () => undefined

type DrawnProps = Readonly<{
  drawn: PrintFinalDrawnFace
  look: PortalPrintKitView['look']
  /** The code as a picture with its quiet zone drawn in; null while it is made. */
  codeUrl: string | null
  framing?: PrintFinalFraming
  /** On a sheet, how far the Immersive art runs past the trim. */
  bleed?: PrintFinalBleed
  pt: PointsToLength
}>

/** A face already laid out, drawn at its trim: what the preview and each sheet cell show. */
export function PrintFinalDrawnFaceArt({
  drawn,
  look,
  codeUrl,
  framing,
  bleed,
  pt,
}: DrawnProps) {
  const paper = drawn.look === 'paper'
  return (
    <div
      data-final-look={drawn.look}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        // A sheet's Immersive art runs into its bleed, past the trim.
        overflow: bleed === undefined ? 'hidden' : 'visible',
        background: paper ? PRINT_KIT_PAPER : drawn.laid.palette.ground,
      }}
    >
      {paper || drawn.waiting ? null : (
        <PrintFinalImmersiveArt
          art={drawn.laid.art}
          photo={
            drawn.photo === null || look.heroUrl === null
              ? null
              : { read: drawn.photo, url: look.heroUrl }
          }
          look={look}
          framing={framing ?? PRINT_FINAL_DEFAULT_FRAMING}
          bleed={bleed}
          pt={pt}
        />
      )}
      <PrintFinalFaceParts
        layout={paper ? drawn.layout : drawn.laid.layout}
        colours={paper ? drawn.colours : drawn.laid.colours}
        look={look}
        codeUrl={codeUrl}
        onLogoAspect={ignoreAspect}
        pt={pt}
      />
    </div>
  )
}

type Props = PrintFinalFaceInput &
  Readonly<{
    codeUrl: string | null
    pt: PointsToLength
  }>

/** One face, laid out and drawn. */
export function PrintFinalFaceArt(props: Props) {
  const drawn = usePrintFinalDrawnFace(props)
  return (
    <PrintFinalDrawnFaceArt
      drawn={drawn}
      look={props.look}
      codeUrl={props.codeUrl}
      framing={props.framing}
      pt={props.pt}
    />
  )
}
