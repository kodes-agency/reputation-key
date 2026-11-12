// Polite live region for notification mutations.
//
// Mark-all-read, clear-all and dismiss change the list silently — with
// optimistic updates the rows just vanish, which a screen-reader user has no
// way to perceive. Each result is announced here. The sequence number is part
// of the rendered key so repeating the SAME message (dismiss, dismiss) replaces
// the text node and is re-announced instead of being swallowed as unchanged.

import { useCallback, useState } from 'react'

export type NotificationAnnouncement = Readonly<{ text: string; seq: number }>

const EMPTY: NotificationAnnouncement = { text: '', seq: 0 }

export function useNotificationAnnouncer(): Readonly<{
  announcement: NotificationAnnouncement
  announce: (text: string) => void
}> {
  const [announcement, setAnnouncement] = useState<NotificationAnnouncement>(EMPTY)
  const announce = useCallback((text: string) => {
    setAnnouncement((previous) => ({ text, seq: previous.seq + 1 }))
  }, [])
  return { announcement, announce }
}

export function NotificationAnnouncer({
  announcement,
}: Readonly<{ announcement: NotificationAnnouncement }>) {
  return (
    <div role="status" aria-live="polite" className="sr-only">
      {announcement.text === '' ? null : (
        <span key={announcement.seq}>{announcement.text}</span>
      )}
    </div>
  )
}
