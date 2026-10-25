// The call to action of the final Print cards section (final design spec §5.5 to
// §5.7 and §8): every wording of the menu checked against the chosen print, a
// picked wording that a later change made too long, and the manager's own words
// with how they print. Each answer is the planner's, the one the PDF uses, run
// on the preview's estimated measures (they err large, so Share never lets
// through what the file would refuse); the own words are checked about 150 ms
// after the last keystroke.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import type { PrintFinalFace } from '#/shared/domain/portal-print-final'
import { choosePrintFinalTile } from '#/shared/domain/portal-print-final-code'
import {
  PRINT_FINAL_COPY,
  type PrintFinalCallToAction,
} from '#/shared/domain/portal-print-final-copy'
import {
  printFinalCustomCopyProblem,
  tidyPrintFinalTyping,
  type PrintFinalCustomCopy,
} from '#/shared/domain/portal-print-final-custom'
import { printFinalBlocks } from '#/shared/domain/portal-print-final-languages'
import { printFinalWordsOffer } from '#/shared/domain/portal-print-final-warnings'
import type { PrintFinalCodeFacts } from '#/shared/domain/portal-print-final-offer'
import {
  printFinalMenuRows,
  type PrintFinalLayoutFor,
  type PrintFinalMenuRow,
} from '#/shared/domain/portal-print-final-words-fit'
import {
  printFinalPickedHeld,
  printFinalPickedTooLong,
} from '#/shared/domain/portal-print-final-words-copy'
import { previewFinalFaceLayout } from './print-final-face-layout'
import type { PrintFinalShareChoice, PrintFinalSharePrint } from './print-final-state'
import { usePrintFinalOwnFit, type PrintFinalOwnFit } from './use-print-final-own-fit'

/** The planner is asked again this long after the last keystroke (§5.7). */
const FIT_DEBOUNCE_MS = 150

type WordsChange = Pick<PrintFinalShareChoice, 'callToAction' | 'customWords'>

type Input = Readonly<{
  print: PrintFinalSharePrint | null
  face: PrintFinalFace
  view: PortalPrintKitView | null
  code: PrintFinalCodeFacts
  editWords: (words: WordsChange) => void
}>

/** Why Download is held back by the words, as its label and the line beside it. */
export type PrintFinalWordsBlock = Readonly<{ label: string; note: string }>

const EVERY_CARD_FITS = 'The PDF is made once every card fits.'

/** `value`, once it has stood still for `ms`; the first value at once. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState<{ value: T } | null>(null)
  useEffect(() => {
    const timer = setTimeout(() => setSettled({ value }), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return settled === null ? value : settled.value
}

/** Lays a face out as the preview does, on the tile the file would print the code on for that piece. */
function previewLayoutFor(
  look: PortalPrintKitView['look'],
  code: PrintFinalCodeFacts,
): PrintFinalLayoutFor {
  return (face, blocks, ownStepOnly) => {
    const chosen = choosePrintFinalTile({ ...face, ...code })
    // A piece this code cannot print on still has words to check: the short address's tile.
    const tile = chosen.isOk()
      ? chosen.value
      : choosePrintFinalTile({
          ...face,
          address: 'short',
          symbolModules: 29,
        })._unsafeUnwrap()
    return previewFinalFaceLayout({
      face,
      blocks,
      look,
      tile,
      logoAspect: null,
      ownStepOnly,
    })
  }
}

/** Why the picked wording cannot print on this print, in the words under the select; null where it can. */
function pickedProblemOf(
  picked: PrintFinalMenuRow | null,
  face: PrintFinalFace,
  languages: readonly GuestLocale[],
): Readonly<{ reason: string; help: string }> | null {
  if (picked === null || picked.state === 'fits') return null
  const headline = PRINT_FINAL_COPY.en[picked.preset].headline
  return picked.state === 'held' && picked.heldIn !== null
    ? printFinalPickedHeld(headline, picked.heldIn)
    : printFinalPickedTooLong(headline, face, languages)
}

export function usePrintFinalWords(input: Input) {
  const { print, face, view, code, editWords } = input
  const { address, symbolModules } = code
  const layoutFor = useMemo(
    () =>
      view === null ? null : previewLayoutFor(view.look, { address, symbolModules }),
    [view, address, symbolModules],
  )
  const languages = print?.languages
  const menu = useMemo((): readonly PrintFinalMenuRow[] => {
    if (languages === undefined || view === null || layoutFor === null) return []
    const blocksOf = (preset: PrintFinalCallToAction) =>
      printFinalBlocks(languages, { preset }, view.titles, view.portalName)
    return printFinalMenuRows(face, languages, blocksOf, layoutFor)
  }, [face, languages, view, layoutFor])
  const words = print?.words
  // What the face says, as the preview draws it: the words as typed, not as settled.
  const blocks = useMemo(
    () =>
      view === null || languages === undefined || words === undefined
        ? []
        : printFinalBlocks(languages, words, view.titles, view.portalName),
    [view, languages, words],
  )
  const isOwn = words?.custom != null
  const settledWords = useSettled(words, FIT_DEBOUNCE_MS)
  const own: PrintFinalOwnFit | null = usePrintFinalOwnFit({
    words: isOwn ? settledWords : undefined,
    languages,
    face,
    view,
    layoutFor,
  })
  const picked = menu.find((row) => row.preset === print?.callToAction) ?? null
  const pickedProblem =
    !isOwn && languages !== undefined ? pickedProblemOf(picked, face, languages) : null
  return {
    blocks,
    menu,
    /** No wording fits the print: the menu says so once, and "Write your own…" stays open. */
    noWordingFits: menu.length > 0 && menu.every((row) => row.state !== 'fits'),
    isOwn,
    /** The picked wording, which a later change made too long or that a language of the print holds back: it stays picked (§5.5, panel 14). */
    pickedProblem,
    own,
    block: wordsBlockOf({ isOwn, pickedProblem, own, words, languages }),
    pick: useCallback(
      (preset: PrintFinalCallToAction) =>
        editWords({ callToAction: preset, customWords: null }),
      [editWords],
    ),
    /** "Write your own…": the fields start from the picked wording in every language. */
    writeOwn: useCallback(() => {
      if (print === null) return
      editWords({ callToAction: print.callToAction, customWords: {} })
    }, [editWords, print]),
    edit: useCallback(
      (locale: GuestLocale, field: keyof PrintFinalCustomCopy, text: string) => {
        const now = print?.words.custom?.[locale]
        if (print === null || now === undefined) return
        editWords({
          callToAction: print.callToAction,
          customWords: {
            ...print.words.custom,
            [locale]: { ...now, [field]: tidyPrintFinalTyping(text) },
          },
        })
      },
      [editWords, print],
    ),
  } as const
}

function wordsBlockOf(
  state: Readonly<{
    isOwn: boolean
    pickedProblem: unknown
    own: PrintFinalOwnFit | null
    words: PrintFinalSharePrint['words'] | undefined
    languages: readonly GuestLocale[] | undefined
  }>,
): PrintFinalWordsBlock | null {
  const { isOwn, own, words, languages } = state
  if (!isOwn) {
    return state.pickedProblem === null
      ? null
      : { label: 'Choose words that fit', note: EVERY_CARD_FITS }
  }
  const emptyHeadline = (languages ?? []).some((locale) => {
    const copy = words?.custom?.[locale]
    return copy !== undefined && printFinalCustomCopyProblem(copy) === 'empty_headline'
  })
  if (emptyHeadline) {
    return { label: 'Download PDF', note: 'Write a headline, or pick a wording.' }
  }
  if (words !== undefined && printFinalWordsOffer(words, languages ?? [])) {
    return {
      label: 'Remove the offer to print',
      note: 'The PDF is made once the offer is gone.',
    }
  }
  if (own?.fit.state === 'refused')
    return { label: 'Shorten to fit', note: EVERY_CARD_FITS }
  return null
}

export type PrintFinalWordsState = ReturnType<typeof usePrintFinalWords>
