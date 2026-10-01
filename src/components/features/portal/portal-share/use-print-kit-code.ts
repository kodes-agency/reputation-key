// The code on the print preview, as a picture the card can show: the live
// code's address when it is in memory, else a sample, drawn in the print's own
// ink and paper. SVG, so it stays sharp at any width, set as an image source
// (never as markup).

import { useEffect, useState } from 'react'
import { PLATE_INK, PLATE_PAPER } from '#/shared/domain/portal-print-kit-layout'
import { QR_QUIET_ZONE_MODULES, renderQrSvg } from './portal-qr'

/** Drawn when the live address is not in memory: a code that opens nothing of ours. */
const PREVIEW_SAMPLE_ADDRESS = 'https://example.com/p/sample'

export function usePrintKitCode(address: string | null): string | null {
  const source = address ?? PREVIEW_SAMPLE_ADDRESS
  const [drawn, setDrawn] = useState<Readonly<{ source: string; url: string }> | null>(
    null,
  )

  useEffect(() => {
    let cancelled = false
    void renderQrSvg(source, QR_QUIET_ZONE_MODULES, {
      dark: PLATE_INK,
      light: PLATE_PAPER,
    })
      .then((svg) => {
        if (cancelled) return
        setDrawn({
          source,
          url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
        })
      })
      // A card without its picture still previews the words; the PDF is unaffected.
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [source])

  return drawn?.source === source ? drawn.url : null
}
