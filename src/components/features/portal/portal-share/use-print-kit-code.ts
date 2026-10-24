// The code on the print preview, as a picture the card can show: the live
// code's address when it is in memory, else a sample, drawn in the print's own
// ink and paper. SVG, so it stays sharp at any width, set as an image source
// (never as markup). It says how many modules the symbol has, which decides the
// tile a Large card prints it on, and which address it encodes.

import { useEffect, useState } from 'react'
import { PRINT_KIT_INK, PRINT_KIT_TILE } from '#/shared/domain/portal-print-kit-palette'
import { QR_QUIET_ZONE_MODULES, renderQrSvg } from './portal-qr'

/**
 * Drawn when the live address is not in memory: a code that opens nothing of
 * ours. It is a version 3 symbol on purpose, the size of the short print
 * address (a test pins that), so a card's preview shows the density a Table or
 * Mini card prints at, not the 53-module code of today's long address.
 */
export const PREVIEW_SAMPLE_ADDRESS = 'https://example.com/p/sample'

export type PrintKitCode = Readonly<{
  /** The address the code encodes: the live one, or the sample. */
  address: string
  /** The picture, with its quiet zone drawn in; null while it is made. */
  url: string | null
  /** Modules along one side of the symbol, the quiet zone not included; null while it is made. */
  symbolModules: number | null
}>

/** The symbol's modules, read from the drawn SVG's view box, which holds the quiet zone too. */
export function symbolModulesOfSvg(svg: string): number | null {
  const match = /viewBox="0 0 (\d+) \d+"/u.exec(svg)
  if (match?.[1] === undefined) return null
  return Number(match[1]) - 2 * QR_QUIET_ZONE_MODULES
}

type Drawn = Readonly<{ source: string; url: string; symbolModules: number | null }>

export function usePrintKitCode(address: string | null): PrintKitCode {
  const source = address ?? PREVIEW_SAMPLE_ADDRESS
  const [drawn, setDrawn] = useState<Drawn | null>(null)

  useEffect(() => {
    let cancelled = false
    void renderQrSvg(source, QR_QUIET_ZONE_MODULES, {
      dark: PRINT_KIT_INK,
      light: PRINT_KIT_TILE,
    })
      .then((svg) => {
        if (cancelled) return
        setDrawn({
          source,
          url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
          symbolModules: symbolModulesOfSvg(svg),
        })
      })
      // A card without its picture still previews the words; the PDF is unaffected.
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [source])

  const current = drawn?.source === source ? drawn : null
  return {
    address: source,
    url: current?.url ?? null,
    symbolModules: current?.symbolModules ?? null,
  }
}
