// Inbox new count badge — for sidebar nav.
// Receives the getNewCount server fn as a prop per src/components/CONTEXT.md:55.
import { useEffect, useState, useCallback, useRef } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { useAction } from '#/components/hooks/use-action'
import type { getNewCountFn } from '#/contexts/inbox/server/inbox'
import { Badge } from '#/components/ui/badge'

export function InboxNewBadge({
  getNewCount,
}: Readonly<{ getNewCount: typeof getNewCountFn }>) {
  const loadAction = useAction(useServerFn(getNewCount))
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
