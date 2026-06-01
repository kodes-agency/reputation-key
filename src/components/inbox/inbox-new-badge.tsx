// Inbox new count badge — for sidebar and page header
// Server import exception: standalone sidebar badge that fetches its own count.
// No parent route provides new count data; self-contained fetching is appropriate
// for a widget that appears in the layout shell, not a specific route.
import { useEffect, useState, useCallback, useRef } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { useAction } from '#/components/hooks/use-action'
import { getNewCountFn } from '#/contexts/inbox/server/inbox'
import { Badge } from '#/components/ui/badge'

export function InboxNewBadge() {
  const loadAction = useAction(useServerFn(getNewCountFn))
  const loadActionRef = useRef(loadAction)
  loadActionRef.current = loadAction
  const [count, setCount] = useState<number | null>(null)
  const abortRef = useRef(false)

  const loadCount = useCallback(async () => {
    abortRef.current = false
    try {
      const result = await loadActionRef.current({ data: {} })
      if (!abortRef.current) {
        setCount(typeof result === 'number' ? result : 0)
      }
    } catch {
      // Silently fail — badge is non-critical
    }
  }, [])

  useEffect(() => {
    loadCount()
    return () => {
      abortRef.current = true
    }
  }, [loadCount])

  if (count === null || count === 0) return null

  return (
    <Badge variant="destructive" className="ml-1.5 min-w-5 justify-center px-1.5 text-xs">
      {count > 99 ? '99+' : count}
    </Badge>
  )
}
