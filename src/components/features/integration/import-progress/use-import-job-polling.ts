// Polling hook for import job status.
// Stable interval via ref — status tracked in ref to avoid re-triggering effect.
// Stops on terminal status or after MAX_CONSECUTIVE_ERRORS failures.

import { useState, useEffect, useRef } from 'react'
import type {
  GbpImportJob,
  GbpImportJobStatus,
} from '#/contexts/integration/application/public-api'
import { getImportStatus } from '#/contexts/integration/server/gbp-import'

const POLL_INTERVAL_MS = 2000
const MAX_CONSECUTIVE_ERRORS = 5
const TERMINAL_STATUSES = new Set<GbpImportJobStatus>([
  'completed',
  'failed',
  'completed_with_skips',
  'completed_with_failures',
])

function isTerminalStatus(status: GbpImportJobStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

export function useImportJobPolling(
  importId: string,
  initialJob: GbpImportJob,
): Readonly<{ job: GbpImportJob; error: Error | null }> {
  const [job, setJob] = useState<GbpImportJob>(initialJob)
  const [error, setError] = useState<Error | null>(null)

  // Track status in ref so the effect doesn't re-fire on each poll update
  const statusRef = useRef(initialJob.status)
  const consecutiveErrors = useRef(0)

  useEffect(() => {
    // If already terminal at mount, nothing to do
    if (isTerminalStatus(statusRef.current)) return

    const intervalId = setInterval(async () => {
      try {
        const result = await getImportStatus({ data: { importId } })
        if (result.job) {
          statusRef.current = result.job.status
          setJob(result.job)
          consecutiveErrors.current = 0
          setError(null)

          // Stop polling if now terminal
          if (isTerminalStatus(result.job.status)) {
            clearInterval(intervalId)
          }
        }
      } catch (e) {
        consecutiveErrors.current++
        if (consecutiveErrors.current >= MAX_CONSECUTIVE_ERRORS) {
          setError(
            e instanceof Error ? e : new Error('Polling failed after multiple attempts'),
          )
          clearInterval(intervalId)
        }
      }
    }, POLL_INTERVAL_MS)

    return () => clearInterval(intervalId)
  }, [importId])

  return { job, error }
}
