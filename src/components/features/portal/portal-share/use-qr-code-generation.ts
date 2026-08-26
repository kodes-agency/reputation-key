import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'

type Generation =
  | Readonly<{ source: string; status: 'ready'; dataUrl: string }>
  | Readonly<{ source: string; status: 'error' }>

export function useQrCodeGeneration(open: boolean, publicUrl: string) {
  const [generation, setGeneration] = useState<Generation | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void QRCode.toDataURL(publicUrl, {
      width: 256,
      margin: 2,
      color: { dark: '#16151a', light: '#faf9fc' },
    })
      .then((dataUrl) => {
        if (!cancelled) setGeneration({ source: publicUrl, status: 'ready', dataUrl })
      })
      .catch(() => {
        if (!cancelled) setGeneration({ source: publicUrl, status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [open, publicUrl])

  const current = generation?.source === publicUrl ? generation : null
  return {
    qrDataUrl: current?.status === 'ready' ? current.dataUrl : null,
    generationError: current?.status === 'error',
    clearGeneration: useCallback(() => setGeneration(null), []),
  } as const
}
