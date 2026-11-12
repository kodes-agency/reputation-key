// A face in the Share tab's preview (design spec §2 to §8), drawn
// from the layout the PDF draws from (`usePrintDrawnFace`). Paper is plain
// paper with the words, marks and code on it (`PrintFaceParts`); Immersive
// paints its photo fade under them (`PrintImmersiveArt`). While the photo
// decodes, an Immersive face shows its words on the plain ground; a photo the
// browser cannot read is drawn as the no-photo ground.
//
// Inline styles on purpose, as the rest of the print preview's: the first-paint
// stylesheet is built by scanning `src/` for class names, and a measure this
// specific would land in every page's.

// A face in the Share tab's preview (design spec §2 to §8), drawn
// from the layout the PDF draws from (`usePrintDrawnFace`). Paper is plain
// paper with the words, marks and code on it (`PrintFaceParts`); Immersive
// paints its photo fade under them (`PrintImmersiveArt`). While the photo
// decodes, an Immersive face shows its words on the plain ground; a photo the
// browser cannot read is drawn as the no-photo ground.
//
// Inline styles on purpose, as the rest of the print preview's: the first-paint
// stylesheet is built by scanning `src/` for class names, and a measure this
// specific would land in every page's.
import type { PortalPrintKitView } from '#/contexts/portal/application/portal-management-contracts'
import {
  PRINT_DEFAULT_FRAMING,
  type PrintFraming,
} from '#/shared/domain/portal-print-framing'
import type { PrintBleed } from '#/shared/domain/portal-print-layers'
import { PRINT_KIT_PAPER } from '#/shared/domain/portal-print-kit-palette'
import type { PointsToLength } from './print-kit-code-block-layout'
import { PrintFaceParts } from './print-face-parts'
import { PrintImmersiveArt } from './print-immersive-art'
import { type PrintDrawnFace } from './use-print-drawn-face'

const ignoreAspect = () => undefined

type DrawnProps = Readonly<{
  drawn: PrintDrawnFace
  look: PortalPrintKitView['look']
  /** The code as a picture with its quiet zone drawn in; null while it is made. */
  codeUrl: string | null
  framing?: PrintFraming
  /** On a sheet, how far the Immersive art runs past the trim. */
  bleed?: PrintBleed
  pt: PointsToLength
}>

/** A face already laid out, drawn at its trim: what the preview and each sheet cell show. */
export function PrintDrawnFaceArt({
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
      data-printState-look={drawn.look}
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
        <PrintImmersiveArt
          art={drawn.laid.art}
          photo={
            drawn.photo === null || look.heroUrl === null
              ? null
              : { read: drawn.photo, url: look.heroUrl }
          }
          look={look}
          framing={framing ?? PRINT_DEFAULT_FRAMING}
          bleed={bleed}
          pt={pt}
        />
      )}
      <PrintFaceParts
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
