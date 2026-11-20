// Portal context — the colour rules every look writer shares: the Property
// look and a Portal's own colours (ADR 0070) refuse the same things in the same
// words, so a colour the Property look page accepts is never refused on a
// Portal, nor the other way round.
//
// What is refused: a colour that is not `#rrggbb`, a background mode that is
// neither automatic nor manual, and a pair whose page text light text cannot
// be read on. An accent that is hard to see on its field is not: the guest
// page draws the text colour in its place (the page's readout says so), and
// the default palette every Property starts with is such an accent. Colours
// are stored in capitals.

import { parseHexColour } from '#/shared/domain/portal-field-colour'
import { readLookContrast } from '#/shared/domain/portal-look-readout'
import { portalError } from '../domain/errors'
import { BACKGROUND_MODES, type BackgroundMode } from '../domain/property-look'

const INVALID_LOOK = 'invalid_theme'

/** The background mode as the writer takes it, or the refusal. */
export function checkedBackgroundMode(mode: string): BackgroundMode {
  const known = BACKGROUND_MODES.find((candidate) => candidate === mode)
  if (known === undefined) {
    throw portalError(INVALID_LOOK, 'Choose an automatic or a manual background')
  }
  return known
}

/** A colour as the writer stores it (in capitals), or the refusal naming which one. */
export function checkedLookColour(value: string, part: 'accent' | 'background'): string {
  if (parseHexColour(value) === null) {
    throw portalError(INVALID_LOOK, `Choose the ${part} as a six-digit colour`)
  }
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
  backgroundMode: string
  /** Read only when the background is manual. */
  backgroundColour?: string
}>

/** A whole pair as the Property look writer takes it: the background only when it is manual. */
export function checkedColours(input: LookColoursInput): Readonly<{
  accent: string
  backgroundMode: BackgroundMode
  background?: string
}> {
  const backgroundMode = checkedBackgroundMode(input.backgroundMode)
  const isManual = backgroundMode === 'manual'
  const accent = checkedLookColour(input.accentColour, 'accent')
  const background = input.backgroundColour ?? ''
  const checkedBackground = isManual
    ? checkedLookColour(background, 'background')
    : undefined
  assertReadableLook({ accent, backgroundMode, backgroundColour: background })
  return {
    accent,
    backgroundMode,
    ...(checkedBackground === undefined ? {} : { background: checkedBackground }),
  }
}
