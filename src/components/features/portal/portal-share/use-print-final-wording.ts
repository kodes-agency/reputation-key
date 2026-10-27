// The saved wording of the final Print cards section (2026-10-27): what Share
// opens on, whether the words on show are the saved ones, and "Save wording".
//
// Share opens on the wording the manager saved, else the wording of the Portal's
// last print, else the default, and applies it once, when the read first arrives.
// A later read (the one after a download, a refocus) never reaches the words on
// screen: they are the manager's from then on. What the words are compared with is
// the wording saved or printed last, which this tab knows because it did the
// saving or the download, so the comparison needs no second read. The read is
// cached for the session and Share is built again on each visit to its tab, so a
// save asks for it again: the next visit opens on the words just saved.

import { useCallback, useRef, useState } from 'react'
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
  saveMutation: PortalPrintKitResources['saveWordingMutation']
  /** Sets the choice's wording and own words: the opening one. */
  open: (wording: PrintFinalSavedWording) => void
  /** Called once the server holds the words: the read is asked again, so a later visit opens on them. */
  onSaved: () => void
}>

/** Why Save is off, in Save's own words: the Download note's "PDF" is not what Save makes. */
const NOTE_OF: Readonly<Record<PrintFinalWordingSaveProblem, string>> = {
  empty_headline: 'Write a headline, or pick a wording.',
  offer: 'Remove the offer to save these words.',
}

export function usePrintFinalWording(input: Input) {
  const { portalId, view, print, saveMutation, open, onSaved } = input
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
  // The mutation's own pending flag reaches a render after the save has settled,
  // so the button is held here, where the focus it must get back is decided.
  const [isSaving, setIsSaving] = useState(false)
  const inFlight = useRef(false)
  const save = useCallback(async () => {
    if (print === null || saveMutation === undefined || problem !== null) return
    if (inFlight.current) return
    inFlight.current = true
    setIsSaving(true)
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
      onSaved()
    } catch {
      // The mutation has already toasted the refusal; the words stay as they are.
    } finally {
      inFlight.current = false
      setIsSaving(false)
    }
  }, [print, saveMutation, problem, portalId, onSaved])
  return {
    /** Offered only while the words on show differ from the saved ones. */
    isOffered: saveMutation !== undefined && isUnsaved,
    isSaving,
    /** Why Save is off: no headline, or an offer. Null when it is on. */
    reason: problem === null ? null : NOTE_OF[problem],
    save,
    /** A download saved what it printed: that is the wording to compare with now. */
    savedByDownload: setSaved,
  } as const
}

export type PrintFinalWordingState = ReturnType<typeof usePrintFinalWording>
