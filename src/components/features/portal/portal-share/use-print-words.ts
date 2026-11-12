// The call to action of the Print cards section (design spec §5.5 to
// §5.7 and §8): every wording of the menu checked against the chosen print, a
// picked wording that a later change made too long, and the manager's own words
// with how they print. Each answer is the planner's, the one the PDF uses, run
// on the preview's estimated measures (they err large, so Share never lets
// through what the file would refuse); the own words are checked about 150 ms
// after the last keystroke.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PortalPrintKitView } from '#/contexts/portal/application/portal-management-contracts'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import type { PrintFace } from '#/shared/domain/portal-print'
import { choosePrintTile } from '#/shared/domain/portal-print-code'
import { PRINT_COPY, type PrintCallToAction } from '#/shared/domain/portal-print-copy'
import {
  printCustomCopyProblem,
  tidyPrintTyping,
  type PrintCustomCopy,
} from '#/shared/domain/portal-print-custom'
import { printBlocks } from '#/shared/domain/portal-print-languages'
import { printWordsOffer } from '#/shared/domain/portal-print-warnings'
import type { PrintCodeFacts } from '#/shared/domain/portal-print-offer'
import {
  printMenuRows,
  type PrintLayoutFor,
  type PrintMenuRow,
} from '#/shared/domain/portal-print-words-fit'
import {
  printPickedHeld,
  printPickedTooLong,
} from '#/shared/domain/portal-print-words-copy'
import { previewFaceLayout } from './print-face-layout'
import type { PrintShareChoice, PrintSharePrint } from './print-state'
import { usePrintOwnFit, type PrintOwnFit } from './use-print-own-fit'

/** The planner is asked again this long after the last keystroke (§5.7). */
const FIT_DEBOUNCE_MS = 150

type WordsChange = Pick<PrintShareChoice, 'callToAction' | 'customWords'>

type Input = Readonly<{
  print: PrintSharePrint | null
  face: PrintFace
  view: PortalPrintKitView | null
  code: PrintCodeFacts
  editWords: (words: WordsChange) => void
}>

/** Why Download is held back by the words, as its label and the line beside it. */
export type PrintWordsBlock = Readonly<{ label: string; note: string }>

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
  code: PrintCodeFacts,
): PrintLayoutFor {
  return (face, blocks, ownStepOnly) => {
    const chosen = choosePrintTile({ ...face, ...code })
    // A piece this code cannot print on still has words to check: the short address's tile.
    const tile = chosen.isOk()
      ? chosen.value
      : choosePrintTile({
          ...face,
          address: 'short',
          symbolModules: 29,
        })._unsafeUnwrap()
    return previewFaceLayout({
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
  picked: PrintMenuRow | null,
  face: PrintFace,
  languages: readonly GuestLocale[],
): Readonly<{ reason: string; help: string }> | null {
  if (picked === null || picked.state === 'fits') return null
  const headline = PRINT_COPY.en[picked.preset].headline
  return picked.state === 'held' && picked.heldIn !== null
    ? printPickedHeld(headline, picked.heldIn)
    : printPickedTooLong(headline, face, languages)
}

export function usePrintWords(input: Input) {
  const { print, face, view, code, editWords } = input
  const { address, symbolModules } = code
  const layoutFor = useMemo(
    () =>
      view === null ? null : previewLayoutFor(view.look, { address, symbolModules }),
    [view, address, symbolModules],
  )
  const languages = print?.languages
  const menu = useMemo((): readonly PrintMenuRow[] => {
    if (languages === undefined || view === null || layoutFor === null) return []
    const blocksOf = (preset: PrintCallToAction) =>
      printBlocks(languages, { preset }, view.titles, view.portalName)
    return printMenuRows(face, languages, blocksOf, layoutFor)
  }, [face, languages, view, layoutFor])
  const words = print?.words
  // What the face says, as the preview draws it: the words as typed, not as settled.
  const blocks = useMemo(
    () =>
      view === null || languages === undefined || words === undefined
        ? []
        : printBlocks(languages, words, view.titles, view.portalName),
    [view, languages, words],
  )
  const isOwn = words?.custom != null
  const settledWords = useSettled(words, FIT_DEBOUNCE_MS)
  const own: PrintOwnFit | null = usePrintOwnFit({
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
      (preset: PrintCallToAction) =>
        editWords({ callToAction: preset, customWords: null }),
      [editWords],
    ),
    /** "Write your own…": the fields start from the picked wording in every language. */
    writeOwn: useCallback(() => {
      if (print === null) return
      editWords({ callToAction: print.callToAction, customWords: {} })
    }, [editWords, print]),
    edit: useCallback(
      (locale: GuestLocale, field: keyof PrintCustomCopy, text: string) => {
        const now = print?.words.custom?.[locale]
        if (print === null || now === undefined) return
        editWords({
          callToAction: print.callToAction,
          customWords: {
            ...print.words.custom,
            [locale]: { ...now, [field]: tidyPrintTyping(text) },
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
    own: PrintOwnFit | null
    words: PrintSharePrint['words'] | undefined
    languages: readonly GuestLocale[] | undefined
  }>,
): PrintWordsBlock | null {
  const { isOwn, own, words, languages } = state
  if (!isOwn) {
    return state.pickedProblem === null
      ? null
      : { label: 'Choose words that fit', note: EVERY_CARD_FITS }
  }
  const emptyHeadline = (languages ?? []).some((locale) => {
    const copy = words?.custom?.[locale]
    return copy !== undefined && printCustomCopyProblem(copy) === 'empty_headline'
  })
  if (emptyHeadline) {
    return { label: 'Download PDF', note: 'Write a headline, or pick a wording.' }
  }
  if (words !== undefined && printWordsOffer(words, languages ?? [])) {
    return {
      label: 'Remove the offer to print',
      note: 'The PDF is made once the offer is gone.',
    }
  }
  if (own?.fit.state === 'refused')
    return { label: 'Shorten to fit', note: EVERY_CARD_FITS }
  return null
}

export type PrintWordsState = ReturnType<typeof usePrintWords>
