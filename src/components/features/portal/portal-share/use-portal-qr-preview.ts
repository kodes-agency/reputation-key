// The on-screen picture of the code, drawn from the address held in memory. The
// address is null after a reload (it is shown only when a code is made or
// replaced), and then there is nothing to draw.

import { useEffect, useState } from 'react'
import { renderQrPreviewDataUrl } from './portal-qr'

type Generation =
  | Readonly<{ source: string; status: 'ready'; dataUrl: string }>
  | Readonly<{ source: string; status: 'error' }>

export function usePortalQrPreview(address: string | null) {
  const [generation, setGeneration] = useState<Generation | null>(null)

  useEffect(() => {
    if (address === null) return
    let cancelled = false
    void renderQrPreviewDataUrl(address)
      .then((dataUrl) => {
        if (!cancelled) setGeneration({ source: address, status: 'ready', dataUrl })
      })
      .catch(() => {
        if (!cancelled) setGeneration({ source: address, status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [address])

  const current = generation?.source === address ? generation : null
  return {
    qrDataUrl: current?.status === 'ready' ? current.dataUrl : null,
    generationError: current?.status === 'error',
  } as const
}
