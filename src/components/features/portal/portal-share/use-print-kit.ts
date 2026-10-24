// The Print kit section's state: the Portal's titles and look (a read that
// follows the live version, as the print does), what the manager has chosen,
// the code the preview draws and the tile the file would print it on, and what
// the preview shows (the whole sheet or one face, and which side). The choice
// starts on the paper the property's country prints on and is the manager's until
// a language, size or piece it names stops being offered; the side falls back to
// the front when the print has only one. The code and its tile are here, not in
// the preview, because the section's "How to print" names the bar the tile makes.

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  PRINT_KIT_SELECTABLE_SIZES,
  printKitFaces,
  type PrintFace,
  type PrintFaceSide,
  type PrintKitChoice,
  type PrintKitSize,
} from '#/shared/domain/portal-print-kit'
import { PRINT_CODE_TOO_SMALL_COPY } from '#/shared/domain/portal-print-kit-code-tile'
import { hasFailed, isRetrying } from '#/components/hooks/is-retrying'
import { portalKeys } from '#/shared/queries/query-keys'
import type { PortalPrintKitReader } from './portal-print-kit-types'
import { previewTile } from './print-kit-card-art-layout'
import type { PrintKitPreviewMode } from './print-kit-preview-copy'
import {
  describeUnprintable,
  printableFace,
  printKitBarMeasure,
  reconcilePrintKitChoice,
  unprintableCharacters,
} from './print-kit-state'
import { usePrintKitCode } from './use-print-kit-code'

type Input = Readonly<{
  portalId: string
  read: PortalPrintKitReader
  /** Off while there is no code to print, or the viewer may not make prints. */
  enabled: boolean
  /** The property's country: it sets the paper the choice starts on. Null: unknown. */
  countryCode: string | null
  /** The live code's QR address, when it is in memory; the preview draws a sample otherwise. */
  qrAddress?: string | null
  /** The sizes managers may choose: `PRINT_KIT_SELECTABLE_SIZES` unless a story shows the hidden ones. */
  sizes?: readonly PrintKitSize[]
}>

export function usePrintKit({
  portalId,
  read,
  enabled,
  countryCode,
  qrAddress = null,
  sizes = PRINT_KIT_SELECTABLE_SIZES,
}: Input) {
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
    view === null
      ? null
      : reconcilePrintKitChoice(chosen, view.locales, countryCode, sizes)
  const code = usePrintKitCode(qrAddress, enabled)
  // The tile the file would print this code on, or why it would refuse it.
  const tile =
    choice === null
      ? null
      : previewTile(
          choice.piece,
          choice.size,
          choice.paper,
          code.address,
          code.symbolModules,
        )
  // A refusal is only known for the live address: the sample code is always short.
  const sample = qrAddress === null
  const planned: readonly PrintFace[] =
    view === null || choice === null
      ? []
      : printKitFaces(choice, view.titles, view.portalName)
  const side = planned.some((face) => face.side === chosenSide) ? chosenSide : 'front'
  return {
    view,
    choice,
    sizes,
    setChoice: setChosen,
    code,
    /** Whether the code drawn is a sample, the live address not being in memory. */
    sample,
    tile,
    /** The bar to measure on the print, for "How to print"; null when the size is refused. */
    barMeasure:
      choice !== null && tile?.isOk() === true
        ? printKitBarMeasure(choice, tile.value.tile.tilePt, sample)
        : null,
    /** Why the live address cannot be printed at this size, in the server's own words; null when it can, or is not known. */
    refusal:
      !sample && tile !== null && tile.isErr()
        ? PRINT_CODE_TOO_SMALL_COPY[tile.error.cause]
        : null,
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
