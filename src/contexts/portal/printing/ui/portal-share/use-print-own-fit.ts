// How the manager's own words print (design spec §5.7 and §8): the fit on
// the chosen piece, both orientations sharing the step, "Shorten by about N"
// from the planner when the headline is refused, and "These words on every card"
// for each piece and orientation. Asked of the words as they stood about 150 ms
// after the last keystroke (`usePrintWords` settles them).

import { useMemo } from 'react'
import type { PortalPrintKitView } from '#/contexts/portal/application/portal-management-contracts'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import type { PrintTextBlock } from '#/shared/domain/portal-print-kit'
import type { PrintFace } from '#/shared/domain/portal-print'
import type { PrintWordsChoice } from '#/shared/domain/portal-print-custom'
import { printBlocks } from '#/shared/domain/portal-print-languages'
import {
  printEveryCard,
  printShortenBy,
  printWordsFit,
  type PrintEveryCardRow,
  type PrintLayoutFor,
  type PrintWordsFit,
} from '#/shared/domain/portal-print-words-fit'

export type PrintOwnFit = Readonly<{
  fit: PrintWordsFit
  /** The planner's cut when the first headline is refused; null otherwise, or when no cut helps. */
  shortenBy: number | null
  everyCard: readonly PrintEveryCardRow[]
  /** The words as checked, so a status names the length it judged. */
  blocks: readonly PrintTextBlock[]
}>

type Input = Readonly<{
  /** The own words to check; undefined while a wording is picked. */
  words: PrintWordsChoice | undefined
  languages: readonly GuestLocale[] | undefined
  face: PrintFace
  view: PortalPrintKitView | null
  layoutFor: PrintLayoutFor | null
}>

/** The planner's cut for a refused first headline: the words of the chosen orientation alone. */
function shortenByOf(
  face: PrintFace,
  blocks: readonly PrintTextBlock[],
  layoutFor: PrintLayoutFor,
): number | null {
  const [first, ...rest] = blocks
  if (first === undefined) return null
  return printShortenBy(
    first.headline,
    (headline) => !layoutFor(face, [{ ...first, headline }, ...rest], true).overflows,
  )
}

export function usePrintOwnFit(input: Input): PrintOwnFit | null {
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
    const blocks = printBlocks(languages, words, view.titles, view.portalName)
    const fit = printWordsFit(face, blocks, layoutFor)
    return {
      fit,
      shortenBy: fit.state === 'refused' ? shortenByOf(face, blocks, layoutFor) : null,
      everyCard: printEveryCard(face, blocks, layoutFor),
      blocks,
    }
  }, [words, languages, face, view, layoutFor])
}
