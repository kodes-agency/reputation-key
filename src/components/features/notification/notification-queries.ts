// Notification query hooks — data fetching + mutations.
// Uses useAction/useMutationAction pattern consistent with codebase.
// Polling for unread count via setInterval (codebase has no TanStack Query).

import { useEffect, useState, useCallback, useRef } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { useAction } from '#/components/hooks/use-action'
import { useMutationActionSilent } from '#/components/hooks/use-mutation-action'
import type {
  getUnreadNotificationCountFn,
  getNotificationsFn,
  markNotificationReadFn,
  markAllNotificationsReadFn,
  dismissNotificationFn,
} from '#/contexts/notification/server/notifications'
import type { Notification } from '#/contexts/notification/application/public-api'

// ── Polling unread count ────────────────────────────────────────────

const POLL_INTERVAL = 30_000

export function useUnreadNotificationCount(
  getUnreadCount: typeof getUnreadNotificationCountFn,
) {
  const rawAction = useAction(useServerFn(getUnreadCount))
  const [count, setCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const actionRef = useRef(rawAction)
  actionRef.current = rawAction

  const fetchCount = useCallback(async () => {
    try {
      const result = await actionRef.current({ data: undefined })
      if (result) setCount(result.count)
    } catch {
      // silently ignore — polling should not disrupt UI
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Initial fetch + polling
  useEffect(() => {
    void fetchCount()
    const id = setInterval(() => void fetchCount(), POLL_INTERVAL)
    return () => clearInterval(id)
  }, [fetchCount])

  return { count, isLoading, refetch: fetchCount }
}

// ── Notification list ───────────────────────────────────────────────

export function useNotifications(getList: typeof getNotificationsFn, limit = 20) {
  const rawAction = useAction(useServerFn(getList))
  const [notifications, setNotifications] = useState<readonly Notification[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const offsetRef = useRef(0)

  // Reset to first page and replace the list.
  const fetchList = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await rawAction({ data: { limit, offset: 0 } })
      offsetRef.current = 0
      const items = (result ?? []) as Notification[]
      setNotifications(items)
      setHasMore(items.length === limit)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load notifications'))
    } finally {
      setIsLoading(false)
    }
  }, [limit])

  // Append the next page. Leaves the existing list intact on failure so the
  // user can retry by clicking again rather than losing what they have.
  const loadMore = useCallback(async () => {
    if (isLoadingMore) return
    setIsLoadingMore(true)
    try {
      const nextOffset = offsetRef.current + limit
      const result = await rawAction({ data: { limit, offset: nextOffset } })
      const items = (result ?? []) as Notification[]
      offsetRef.current = nextOffset
      setNotifications((prev) => [...prev, ...items])
      setHasMore(items.length === limit)
    } catch {
      // Non-fatal: keep current list, button stays available for retry.
    } finally {
      setIsLoadingMore(false)
    }
  }, [limit, isLoadingMore])

  useEffect(() => {
    void fetchList()
  }, [fetchList])

  return {
    notifications,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    refetch: fetchList,
    loadMore,
  }
}

// ── Mark single notification read ───────────────────────────────────

export function useMarkNotificationRead(markRead: typeof markNotificationReadFn) {
  return useMutationActionSilent(markRead)
}

// ── Mark all notifications read ─────────────────────────────────────

export function useMarkAllNotificationsRead(
  markAllRead: typeof markAllNotificationsReadFn,
) {
  return useMutationActionSilent(markAllRead)
}

// ── Dismiss notification ────────────────────────────────────────────

export function useDismissNotification(dismiss: typeof dismissNotificationFn) {
  return useMutationActionSilent(dismiss)
}
