// The Print kit section's state: the Portal's titles and look (a read that
// follows the live version, as the print does), what the manager has chosen,
// and what the preview shows (the whole sheet or one face, and which side). The
// choice starts on the paper the property's country prints on and is the
// manager's until a language it names stops being offered; the side falls back
// to the front when the print has only one.

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  printKitFaces,
  type PrintFace,
  type PrintFaceSide,
  type PrintKitChoice,
} from '#/shared/domain/portal-print-kit'
import { hasFailed, isRetrying } from '#/components/hooks/is-retrying'
import { portalKeys } from '#/shared/queries/query-keys'
import type { PortalPrintKitReader } from './portal-print-kit-types'
import type { PrintKitPreviewMode } from './print-kit-preview-copy'
import {
  describeUnprintable,
  printableFace,
  reconcilePrintKitChoice,
  unprintableCharacters,
} from './print-kit-state'

type Input = Readonly<{
  portalId: string
  read: PortalPrintKitReader
  /** Off while there is no code to print, or the viewer may not make prints. */
  enabled: boolean
  /** The property's country: it sets the paper the choice starts on. Null: unknown. */
  countryCode: string | null
}>

export function usePrintKit({ portalId, read, enabled, countryCode }: Input) {
  const [chosen, setChosen] = useState<PrintKitChoice | null>(null)
  const [mode, setMode] = useState<PrintKitPreviewMode>('sheet')
  const [chosenSide, setChosenSide] = useState<PrintFaceSide>('front')
  const query = useQuery({
    queryKey: portalKeys.printKit(portalId),
    queryFn: () => read({ data: { portalId } }),
    enabled,
    staleTime: 30_000,
  })
  const view = query.data ?? null
  const choice =
    view === null ? null : reconcilePrintKitChoice(chosen, view.locales, countryCode)
  const planned: readonly PrintFace[] =
    view === null || choice === null
      ? []
      : printKitFaces(choice, view.titles, view.portalName)
  const side = planned.some((face) => face.side === chosenSide) ? chosenSide : 'front'
  return {
    view,
    choice,
    setChoice: setChosen,
    /** The faces as the file prints them: without the characters no font carries. */
    faces: planned.map(printableFace),
    mode,
    setMode,
    side,
    setSide: setChosenSide,
    /** Names the characters of this print that its fonts lack; null when all will print. */
    unprintableNote:
      view === null
        ? null
        : describeUnprintable(unprintableCharacters(view.look, planned)),
    isPending: query.isPending && enabled,
    isError: hasFailed(query),
    error: query.error,
    isRetrying: isRetrying(query),
    retry: () => void query.refetch(),
  } as const
}
