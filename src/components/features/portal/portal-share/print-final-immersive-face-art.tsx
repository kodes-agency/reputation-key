// A final Immersive face in the Share tab's preview (final design spec §4 and
// §6): the photo and the logo decoded in the browser, the face laid out and
// painted by the planner the PDF uses (`previewFinalImmersiveFace`), its art
// drawn in CSS and its words, marks and code over it. While the photo decodes,
// the face shows its words on the plain ground; a photo the browser cannot
// read is drawn as the no-photo ground.

import { useMemo } from 'react'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import type { PrintTextBlock } from '#/shared/domain/portal-print-kit'
import type { PrintFinalFace } from '#/shared/domain/portal-print-final'
import type { PrintFinalTile } from '#/shared/domain/portal-print-final-code'
import {
  PRINT_FINAL_DEFAULT_FRAMING,
  type PrintFinalFraming,
} from '#/shared/domain/portal-print-final-framing'
import type { PointsToLength } from './print-kit-code-block-layout'
import { previewFinalImmersiveFace } from './print-final-face-layout'
import { PrintFinalFaceParts } from './print-final-face-parts'
import { PrintFinalImmersiveArt } from './print-final-immersive-art'
import { usePreviewFinalLogo, usePreviewFinalPhoto } from './use-print-final-pictures'

type Props = Readonly<{
  face: PrintFinalFace
  blocks: readonly PrintTextBlock[]
  look: PortalPrintKitView['look']
  tile: PrintFinalTile
  codeUrl: string | null
  framing?: PrintFinalFraming
  pt: PointsToLength
}>

const ignoreAspect = () => undefined

export function PrintFinalImmersiveFaceArt({
  face,
  blocks,
  look,
  tile,
  codeUrl,
  framing,
  pt,
}: Props) {
  const photo = usePreviewFinalPhoto(look.heroUrl)
  const logo = usePreviewFinalLogo(look.logoUrl)
  const read = photo.status === 'read' ? photo.value : null
  const logoRead = logo.status === 'read' ? logo.value : null
  // Reading every word against the photo is the costly part: once per change of what the face shows.
  const laid = useMemo(
    () =>
      previewFinalImmersiveFace({
        face,
        blocks,
        look,
        tile,
        logo: logoRead,
        photo: read,
        framing,
      }),
    [face, blocks, look, tile, logoRead, read, framing],
  )
  const waiting = photo.status === 'reading'
  return (
    <div
      data-final-look="immersive"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: laid.palette.ground,
      }}
    >
      {waiting ? null : (
        <PrintFinalImmersiveArt
          art={laid.art}
          photo={
            read === null || look.heroUrl === null ? null : { read, url: look.heroUrl }
          }
          look={look}
          framing={framing ?? PRINT_FINAL_DEFAULT_FRAMING}
          pt={pt}
        />
      )}
      <PrintFinalFaceParts
        layout={laid.layout}
        colours={laid.colours}
        look={look}
        codeUrl={codeUrl}
        onLogoAspect={ignoreAspect}
        pt={pt}
      />
    </div>
  )
}
