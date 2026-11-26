// Portal context — the colour rules every look writer shares: the Property
// look and a Portal's own colours (ADR 0070) refuse the same things in the same
// words, so a colour the Property look page accepts is never refused on a
// Portal, nor the other way round.
//
// What is refused here: a pair whose page text light text cannot be read on.
// The input schemas already hold each colour to `#rrggbb` and the background
// mode to automatic or manual. An accent that is hard to see on its field is
// not refused: the guest page draws the text colour in its place (the page's
// readout says so), and the default palette every Property starts with is such
// an accent. Colours are stored in capitals.

import { readLookContrast } from '#/shared/domain/portal-look-readout'
import { portalError } from '../domain/errors'
import type { BackgroundMode } from '../domain/property-look'

const INVALID_LOOK = 'invalid_theme'

/** A colour, already a `#rrggbb` by the input schema, as the writer stores it (in capitals). */
export function storedLookColour(value: string): string {
  return value.toUpperCase()
}

/** Refuses a pair whose page text could not be read, judged as the page draws it. */
function assertReadableLook(
  colours: Readonly<{
    accent: string
    backgroundMode: BackgroundMode
    backgroundColour: string
  }>,
): void {
  const readout = readLookContrast(colours)
  if (readout === null) throw portalError(INVALID_LOOK, 'Choose valid colours')
  if (!readout.smallText.isReadable) {
    throw portalError(INVALID_LOOK, 'Page text cannot be read on this background')
  }
}

export type LookColoursInput = Readonly<{
  accentColour: string
  backgroundMode: BackgroundMode
  /** Read only when the background is manual. */
  backgroundColour?: string
}>

/** A whole pair as the Property look writer takes it: the background only when it is manual. */
export function checkedColours(input: LookColoursInput): Readonly<{
  accent: string
  backgroundMode: BackgroundMode
  background?: string
}> {
  const { backgroundMode } = input
  const accent = storedLookColour(input.accentColour)
  const background = input.backgroundColour ?? ''
  const checkedBackground =
    backgroundMode === 'manual' ? storedLookColour(background) : undefined
  assertReadableLook({ accent, backgroundMode, backgroundColour: background })
  return {
    accent,
    backgroundMode,
    ...(checkedBackground === undefined ? {} : { background: checkedBackground }),
  }
}
