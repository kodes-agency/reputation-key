// Data-fetching hook for GBP locations.
// Parametric read triggered by user account selection — not a route loader, not a mutation.
// Keeps previous locations visible during refetch to avoid flash-to-empty.

import { useState, useEffect, useRef, useCallback } from 'react'
import type { GbpLocation } from '#/contexts/integration/application/public-api'
import type { listGbpLocations } from '#/contexts/integration/server/gbp-import'

type State = Readonly<{
  locations: readonly GbpLocation[]
  isLoading: boolean
  error: Error | null
}>

const INITIAL_STATE: State = { locations: [], isLoading: false, error: null }

export function useGbpLocations(
  connectionId: string | undefined,
  listLocations: typeof listGbpLocations,
): State {
  const [state, setState] = useState<State>(INITIAL_STATE)
  const abortRef = useRef<AbortController | null>(null)
  const lastFetchedId = useRef<string | undefined>(undefined)

  const fetchLocations = useCallback(async (id: string) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    // Keep previous locations visible during loading (no flash-to-empty)
    setState((prev) => ({ ...prev, isLoading: true, error: null }))

    try {
      const result = await listLocations({ data: { connectionId: id } })
      if (!controller.signal.aborted) {
        setState({ locations: result.locations, isLoading: false, error: null })
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        setState({
          locations: [],
          isLoading: false,
          error: e instanceof Error ? e : new Error(String(e)),
        })
      }
    }
  }, [])

  useEffect(() => {
    if (!connectionId) {
      abortRef.current?.abort()
      setState(INITIAL_STATE)
      lastFetchedId.current = undefined
      return
    }

    if (lastFetchedId.current === connectionId) return
    lastFetchedId.current = connectionId

    fetchLocations(connectionId)

    return () => {
      abortRef.current?.abort()
    }
  }, [connectionId, fetchLocations])

  return state
}
