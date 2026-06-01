// Keyboard shortcuts for inbox list navigation — j/k/ArrowUp/Down/Escape.
// Extracted from inbox-page-v2.tsx for max-lines compliance.
import { useEffect, useRef } from 'react'
import type { InboxItem } from '#/contexts/inbox/application/public-api'

export function useInboxKeyboardShortcuts({
  items,
  isMobile,
  selectedItem,
  handleRowClick,
  closeDetail,
}: Readonly<{
  items: ReadonlyArray<InboxItem>
  isMobile: boolean
  selectedItem: InboxItem | null
  handleRowClick: (item: InboxItem) => void
  closeDetail: () => void
}>) {
  const selectedIndexRef = useRef(-1)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      )
        return

      if (isMobile) return

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault()
          if (selectedIndexRef.current < 0 && items.length > 0) {
            selectedIndexRef.current = 0
            const first = items[0]
            if (first) handleRowClick(first)
          } else if (selectedIndexRef.current < items.length - 1) {
            selectedIndexRef.current++
            const next = items[selectedIndexRef.current]
            if (next) handleRowClick(next)
          }
          break
        case 'k':
        case 'ArrowUp':
          e.preventDefault()
          if (selectedIndexRef.current > 0) {
            selectedIndexRef.current--
            const prev = items[selectedIndexRef.current]
            if (prev) handleRowClick(prev)
          }
          break
        case 'Escape':
          e.preventDefault()
          closeDetail()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [items, isMobile, handleRowClick, closeDetail])

  // Sync selectedIndexRef when selectedItem changes
  useEffect(() => {
    if (selectedItem) {
      const idx = items.findIndex((i) => i.id === selectedItem.id)
      if (idx !== -1) selectedIndexRef.current = idx
    } else {
      selectedIndexRef.current = -1
    }
  }, [selectedItem, items])

  return { selectedIndexRef }
}
