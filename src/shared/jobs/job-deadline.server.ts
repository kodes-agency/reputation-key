import { withExecutionDeadline } from '#/shared/db/execution-deadline.server'
import { getLogger } from '#/shared/observability/logger'
import { JobTimeoutError } from './errors'

const ABORT_GRACE_MS = 5_000

/** Keep the BullMQ slot until work stops, or terminate the whole worker. */
export async function runJobWithDeadline<T>(
  jobName: string,
  timeoutMs: number,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  const timeoutError = new JobTimeoutError(jobName, timeoutMs)
  let graceTimer: ReturnType<typeof setTimeout> | undefined
  const deadlineTimer = setTimeout(() => {
    graceTimer = setTimeout(() => {
      getLogger().error(
        { jobName, timeoutMs, graceMs: ABORT_GRACE_MS },
        'job did not stop after abort grace; terminating worker',
      )
      // A graceful drain would wait for this same handler. Exit while its
      // processor is still pending so BullMQ cannot release or retry it early.
      process.exit(1)
    }, ABORT_GRACE_MS)
    controller.abort(timeoutError)
  }, timeoutMs)

  try {
    return await withExecutionDeadline(
      { signal: controller.signal, expiresAt: Date.now() + timeoutMs },
      async () => {
        try {
          const result = await work(controller.signal)
          controller.signal.throwIfAborted()
          return result
        } catch (error) {
          controller.signal.throwIfAborted()
          throw error
        }
      },
    )
  } finally {
    clearTimeout(deadlineTimer)
    clearTimeout(graceTimer)
  }
}
