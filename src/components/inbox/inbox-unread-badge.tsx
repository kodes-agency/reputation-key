// Inbox unread count badge — for sidebar and page header
import { useEffect, useState, useCallback, useRef } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { useAction } from '#/components/hooks/use-action'
import { getUnreadCountFn } from '#/contexts/inbox/server/inbox'
import { Badge } from '#/components/ui/badge'

type Props = Readonly<{
  organizationId: string
  userId: string
}>

export function InboxUnreadBadge({ organizationId, userId }: Props) {
  const loadAction = useAction(useServerFn(getUnreadCountFn))
  const [count, setCount] = useState<number | null>(null)
  const abortRef = useRef(false)

  const loadCount = useCallback(async () => {
    abortRef.current = false
    try {
      const result = await loadAction({
        data: { organizationId, userId },
      })
      if (!abortRef.current) {
        setCount(typeof result === 'number' ? result : (result as { count: number }).count)
      }
    } catch {
      // Silently fail — badge is non-critical
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, userId])

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
