/**
 * Runs `tick` every `intervalMs`, one run at a time: a tick that lands while
 * the previous run is still going is skipped. A failed run goes to `onError`,
 * never thrown. `isStopped` lets a long tick end its own loop early. The
 * returned stop function ends the timer and waits for the run in flight.
 */
export function startSingleFlight(
  input: Readonly<{
    tick: (isStopped: () => boolean) => Promise<unknown>
    intervalMs: number
    immediate: boolean
    onError: (error: unknown) => void
  }>,
): () => Promise<void> {
  let inFlight: Promise<void> | undefined
  let stopped = false
  const isStopped = () => stopped
  const run = () => {
    inFlight ??= input
      .tick(isStopped)
      .then(() => undefined)
      .catch(input.onError)
      .finally(() => {
        inFlight = undefined
      })
  }
  if (input.immediate) run()
  const timer = setInterval(run, input.intervalMs)
  return async () => {
    stopped = true
    clearInterval(timer)
    await inFlight
  }
}
