import { useState, useCallback } from 'react'

export function usePreviewToggle(portalId: string) {
  const storageKey = `portal-preview-open-${portalId}`

  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return false
    try {
      return localStorage.getItem(storageKey) === 'true'
    } catch {
      return false
    }
  })

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen)
      try {
        localStorage.setItem(storageKey, String(nextOpen))
      } catch {
        // ignore storage errors
      }
    },
    [storageKey],
  )

  return { previewOpen: open, setPreviewOpen: handleOpenChange } as const
}
