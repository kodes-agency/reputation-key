// Notification query hooks — data fetching + mutations.
// Uses useAction/useMutationAction pattern consistent with codebase.
// Polling for unread count via setInterval (codebase has no TanStack Query).

import { useEffect, useState, useCallback, useRef } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { useAction } from '#/components/hooks/use-action'
import { useMutationActionSilent } from '#/components/hooks/use-mutation-action'
import {
  getUnreadNotificationCountFn,
  getNotificationsFn,
  markNotificationReadFn,
  markAllNotificationsReadFn,
} from '#/contexts/notification/server/notifications'
import type { Notification } from '#/contexts/notification/application/public-api'

// ── Polling unread count ────────────────────────────────────────────

const POLL_INTERVAL = 30_000

export function useUnreadNotificationCount() {
  const rawAction = useAction(useServerFn(getUnreadNotificationCountFn))
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

export function useNotifications(limit = 20) {
  const rawAction = useAction(useServerFn(getNotificationsFn))
  const [notifications, setNotifications] = useState<readonly Notification[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const fetchList = useCallback(async () => {
    setIsLoading(true)
    try {
      const result = await rawAction({ data: { limit } })
      if (result) setNotifications(result as Notification[])
    } catch {
      // silently ignore
    } finally {
      setIsLoading(false)
    }
  }, [limit])

  useEffect(() => {
    void fetchList()
  }, [fetchList])

  return { notifications, isLoading, refetch: fetchList }
}

// ── Mark single notification read ───────────────────────────────────

export function useMarkNotificationRead() {
  return useMutationActionSilent(markNotificationReadFn)
}

// ── Mark all notifications read ─────────────────────────────────────

export function useMarkAllNotificationsRead() {
  return useMutationActionSilent(markAllNotificationsReadFn)
}
