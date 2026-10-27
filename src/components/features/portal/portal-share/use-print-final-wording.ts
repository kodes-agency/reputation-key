// The saved wording of the final Print cards section (2026-10-27): what Share
// opens on, whether the words on show are the saved ones, and "Save wording".
//
// Share opens on the wording the manager saved, else the wording of the Portal's
// last print, else the default, and applies it once, when the read first arrives.
// A later read (the one after a download, a refocus) never reaches the words on
// screen: they are the manager's from then on. What the words are compared with is
// the wording saved or printed last, which this tab knows because it did the
// saving or the download, so the comparison needs no second read.

import { useCallback, useState } from 'react'
import type { PortalPrintKitView } from '#/contexts/portal/application/public-api'
import {
  printFinalOpeningWording,
  printFinalWordingIsSaved,
  printFinalWordingSaveProblem,
  printFinalWordingToSave,
  type PrintFinalSavedWording,
  type PrintFinalWordingSaveProblem,
} from '#/shared/domain/portal-print-final-wording'
import type { PortalPrintKitResources } from './portal-print-kit-types'
import type { PrintFinalSharePrint } from './print-final-state'
import type { PrintFinalWordsBlock } from './use-print-final-words'

/** The wording a Portal's last print said, which a Portal printed before saving was offered still opens on. */
function lastPrintWording(view: PortalPrintKitView): PrintFinalSavedWording | null {
  const last = view.lastPrint
  return last === null
    ? null
    : { callToAction: last.settings.callToAction, customWords: last.settings.customWords }
}

type Input = Readonly<{
  portalId: string
  view: PortalPrintKitView | null
  print: PrintFinalSharePrint | null
  /** The words step's own reason for holding the words back, which Save gives too. */
  block: PrintFinalWordsBlock | null
  saveMutation: PortalPrintKitResources['saveWordingMutation']
  /** Sets the choice's wording and own words: the opening one. */
  open: (wording: PrintFinalSavedWording) => void
}>

/** Used when the words step names no reason of its own for the problem. */
const NOTE_OF: Readonly<Record<PrintFinalWordingSaveProblem, string>> = {
  empty_headline: 'Write a headline, or pick a wording.',
  offer: 'Remove the offer to save these words.',
}

export function usePrintFinalWording(input: Input) {
  const { portalId, view, print, block, saveMutation, open } = input
  // Null until the read first arrives; then the wording Share opened on, and after
  // each save or download the wording that was saved or printed.
  const [saved, setSaved] = useState<PrintFinalSavedWording | null>(null)
  if (saved === null && view !== null) {
    const opening = printFinalOpeningWording(view.savedWording, lastPrintWording(view))
    setSaved(opening)
    open(opening)
  }
  const problem =
    print === null ? null : printFinalWordingSaveProblem(print.words, print.languages)
  const isUnsaved =
    print !== null &&
    saved !== null &&
    !printFinalWordingIsSaved(print.words, print.languages, saved)
  const save = useCallback(async () => {
    if (print === null || saveMutation === undefined || problem !== null) return
    const wording = printFinalWordingToSave(print.words, print.languages)
    try {
      await saveMutation({
        data: {
          portalId,
          callToAction: wording.callToAction,
          customWords: wording.customWords,
        },
      })
      setSaved(wording)
    } catch {
      // The mutation has already toasted the refusal; the words stay as they are.
    }
  }, [print, saveMutation, problem, portalId])
  return {
    /** Offered only while the words on show differ from the saved ones. */
    isOffered: saveMutation !== undefined && isUnsaved,
    isSaving: saveMutation?.isPending ?? false,
    /** Why Save is off, in the words the Download note gives: no headline, or an offer. Null when it is on. */
    reason: problem === null ? null : (block?.note ?? NOTE_OF[problem]),
    save,
    /** A download saved what it printed: that is the wording to compare with now. */
    savedByDownload: setSaved,
  } as const
}

export type PrintFinalWordingState = ReturnType<typeof usePrintFinalWording>
