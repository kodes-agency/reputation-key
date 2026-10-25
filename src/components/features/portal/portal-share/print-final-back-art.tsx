// A card's back page in the Share tab's preview (final design spec §10.4), drawn
// from the layout the PDF draws from (`usePrintFinalDrawnBack`): the logo, on its
// cream plate where the front has one, or the wordmark, and the property's name,
// each where the file puts its ink. Paper is plain paper; Immersive stands on the
// front's ground and washes with no photo (`PrintFinalImmersiveArt`). On a sheet's
// reverse the Immersive ground runs into its bleed.
//
// Inline styles on purpose, as the rest of the print preview's: the first-paint
// stylesheet is built by scanning `src/` for class names, and a measure this
// specific would land in every page's.

import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import { PRINT_FINAL_DEFAULT_FRAMING } from '#/shared/domain/portal-print-final-framing'
import type { PrintFinalBleed } from '#/shared/domain/portal-print-final-layers'
import { PRINT_KIT_PAPER } from '#/shared/domain/portal-print-kit-palette'
import type { PointsToLength } from './print-kit-code-block-layout'
import { Lines, Logo } from './print-final-face-parts'
import { PrintFinalImmersiveArt } from './print-final-immersive-art'
import type { PrintFinalDrawnBack } from './use-print-final-drawn-back'

const ignoreAspect = () => undefined

type Props = Readonly<{
  drawn: PrintFinalDrawnBack
  look: PortalPrintKitView['look']
  /** On a sheet, how far the Immersive ground runs past the trim. */
  bleed?: PrintFinalBleed
  pt: PointsToLength
}>

/** A back already laid out, drawn at its trim: what the preview and each cell of a sheet's reverse show. */
export function PrintFinalDrawnBackArt({ drawn, look, bleed, pt }: Props) {
  const { layout, colours, art, ground } = drawn
  return (
    <div
      data-final-back={art === null ? 'paper' : 'immersive'}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: bleed === undefined ? 'hidden' : 'visible',
        background: ground ?? PRINT_KIT_PAPER,
      }}
    >
      {art === null ? null : (
        <PrintFinalImmersiveArt
          art={art}
          photo={null}
          look={look}
          framing={PRINT_FINAL_DEFAULT_FRAMING}
          bleed={bleed}
          pt={pt}
        />
      )}
      {layout.plan.parts.map((part, index) => {
        const content = layout.contents[index]
        switch (content?.kind) {
          case 'wordmark':
            return (
              <Lines
                key={part.key}
                set={content.set}
                part={part}
                colour={colours.ink}
                lang={null}
                pt={pt}
              />
            )
          case 'name':
            return (
              <Lines
                key={part.key}
                set={content.set}
                part={part}
                colour={colours.soft}
                lang={null}
                pt={pt}
              />
            )
          case 'logo':
            return (
              <Logo
                key={part.key}
                content={content}
                part={part}
                colours={colours}
                look={look}
                onLogoAspect={ignoreAspect}
                pt={pt}
              />
            )
          default:
            return null
        }
      })}
    </div>
  )
}
