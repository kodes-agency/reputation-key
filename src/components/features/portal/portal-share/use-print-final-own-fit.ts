// How the manager's own words print (final design spec §5.7 and §8): the fit on
// the chosen piece, both orientations sharing the step, "Shorten by about N"
// from the planner when the headline is refused, and "These words on every card"
// for each piece and orientation. Asked of the words as they stood about 150 ms
// after the last keystroke (`usePrintFinalWords` settles them).

import { useMemo } from 'react'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import type { PrintTextBlock } from '#/shared/domain/portal-print-kit'
import type { PrintFinalFace } from '#/shared/domain/portal-print-final'
import type { PrintFinalWordsChoice } from '#/shared/domain/portal-print-final-custom'
import { printFinalBlocks } from '#/shared/domain/portal-print-final-languages'
import {
  printFinalEveryCard,
  printFinalShortenBy,
  printFinalWordsFit,
  type PrintFinalEveryCardRow,
  type PrintFinalLayoutFor,
  type PrintFinalWordsFit,
} from '#/shared/domain/portal-print-final-words-fit'

export type PrintFinalOwnFit = Readonly<{
  fit: PrintFinalWordsFit
  /** The planner's cut when the first headline is refused; null otherwise, or when no cut helps. */
  shortenBy: number | null
  everyCard: readonly PrintFinalEveryCardRow[]
  /** The words as checked, so a status names the length it judged. */
  blocks: readonly PrintTextBlock[]
}>

type Input = Readonly<{
  /** The own words to check; undefined while a wording is picked. */
  words: PrintFinalWordsChoice | undefined
  languages: readonly GuestLocale[] | undefined
  face: PrintFinalFace
  view: PortalPrintKitView | null
  layoutFor: PrintFinalLayoutFor | null
}>

/** The planner's cut for a refused first headline: the words of the chosen orientation alone. */
function shortenByOf(
  face: PrintFinalFace,
  blocks: readonly PrintTextBlock[],
  layoutFor: PrintFinalLayoutFor,
): number | null {
  const [first, ...rest] = blocks
  if (first === undefined) return null
  return printFinalShortenBy(
    first.headline,
    (headline) => !layoutFor(face, [{ ...first, headline }, ...rest], true).overflows,
  )
}

export function usePrintFinalOwnFit(input: Input): PrintFinalOwnFit | null {
  const { words, languages, face, view, layoutFor } = input
  return useMemo(() => {
    if (
      words === undefined ||
      languages === undefined ||
      view === null ||
      layoutFor === null
    ) {
      return null
    }
    const blocks = printFinalBlocks(languages, words, view.titles, view.portalName)
    const fit = printFinalWordsFit(face, blocks, layoutFor)
    return {
      fit,
      shortenBy: fit.state === 'refused' ? shortenByOf(face, blocks, layoutFor) : null,
      everyCard: printFinalEveryCard(face, blocks, layoutFor),
      blocks,
    }
  }, [words, languages, face, view, layoutFor])
}
