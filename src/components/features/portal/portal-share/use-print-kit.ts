// The Print kit section's state: the Portal's titles and look (a read that
// follows the working copy), what the manager has chosen, and which side of the
// print the preview shows. The choice is the manager's until a language it
// names stops being offered; the side falls back to the front when the print
// has only one.

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  printKitFaces,
  type PrintFace,
  type PrintFaceSide,
  type PrintKitChoice,
} from '#/shared/domain/portal-print-kit'
import { isRetrying } from '#/components/hooks/is-retrying'
import { portalKeys } from '#/shared/queries/query-keys'
import type { PortalPrintKitReader } from './portal-print-kit-types'
import { reconcilePrintKitChoice } from './print-kit-state'

type Input = Readonly<{
  portalId: string
  read: PortalPrintKitReader
  /** Off while there is no code to print, or the viewer may not make prints. */
  enabled: boolean
}>

export function usePrintKit({ portalId, read, enabled }: Input) {
  const [chosen, setChosen] = useState<PrintKitChoice | null>(null)
  const [chosenSide, setChosenSide] = useState<PrintFaceSide>('front')
  const query = useQuery({
    queryKey: portalKeys.printKit(portalId),
    queryFn: () => read({ data: { portalId } }),
    enabled,
    staleTime: 30_000,
  })
  const view = query.data ?? null
  const choice = view === null ? null : reconcilePrintKitChoice(chosen, view.locales)
  const faces: readonly PrintFace[] =
    view === null || choice === null
      ? []
      : printKitFaces(choice, view.titles, view.portalName)
  const face =
    faces.find((candidate) => candidate.side === chosenSide) ?? faces[0] ?? null
  return {
    view,
    choice,
    setChoice: setChosen,
    faces,
    face,
    side: face?.side ?? 'front',
    setSide: setChosenSide,
    isPending: query.isPending && enabled,
    isError: query.isError,
    isRetrying: isRetrying(query),
    retry: () => void query.refetch(),
  } as const
}
