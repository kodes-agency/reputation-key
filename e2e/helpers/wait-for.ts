// ── Polling ───────────────────────────────────────────────────────────

/**
 * Thrown by a probe to say "the thing being waited for can no longer happen".
 *
 * A probe has three distinct things to communicate and only had two ways to say
 * them: `null` for "not yet" and a throw for "transient error, keep trying".
 * A subject that reached a TERMINAL state the caller was not waiting for is
 * neither — it will never become true, so polling on is pure waste. The Google
 * import wait burned its FULL budget three times (30s, then 60s, then 90s
 * across 335 healthy probes) on an import that had already finished as
 * `completed_with_issues`, and each failure was misread as a slow worker and
 * "fixed" by raising the bound.
 */
export class WaitBailedError extends Error {
  readonly bailed = true
  constructor(description: string, observed: unknown) {
    super(
      `waitFor bailed: ${description} reached a terminal state: ${JSON.stringify(observed)}`,
    )
    this.name = 'WaitBailedError'
  }
}

/** Abort a `waitFor` immediately — the awaited condition is now unreachable. */
export function bailWait(description: string, observed: unknown): never {
  throw new WaitBailedError(description, observed)
}

/**
 * Default budget for a `waitFor` that does not name one.
 *
 * Convention: a wait that polls a REAL BACKGROUND WORKER (outbox relay, BullMQ
 * job, import processor) omits `timeoutMs` and passes `diagnose`. 90s is not a
 * guess about how slow the worker is — it is the ceiling that keeps a loaded
 * runner from being reported as a wedged system. The assertions after the wait
 * are what prove the behaviour; the budget only bounds the wrong answer.
 *
 * Waits on a synchronous read (a DB row a server fn just wrote, a rendered
 * element) should still pass an explicit short budget — a 90s wait on those
 * hides a real hang for 90 seconds.
 *
 * History: 30s and 45s budgets on worker-polling waits produced two of this
 * suite's three known flake signatures (reply-lifecycle terminal-403 at 30s,
 * transient-retry at 45s), each costing a ~10-minute CI rerun to classify.
 */
const DEFAULT_WAIT_TIMEOUT_MS = 90_000

export async function waitFor<T>(
  probe: () => Promise<T | null | undefined | false>,
  options: {
    /** Omit for worker-polling waits — see DEFAULT_WAIT_TIMEOUT_MS. */
    timeoutMs?: number
    intervalMs?: number
    description: string
    /**
     * Called ONCE, only on timeout, to say what the world actually looked like.
     *
     * A probe signals "not yet" by returning null, so on timeout the helper
     * otherwise has nothing to report and the failure reads
     * `waitFor timed out after 60000ms: <description>` — which cannot
     * distinguish a slow-but-progressing background worker from a wedged one.
     * That is the difference between a flake to re-run and a bug to fix, and
     * every one of these call sites was throwing it away.
     *
     * Must not throw: if it does, the reason is reported instead of the value,
     * because a diagnostic that masks the real timeout is worse than none.
     */
    diagnose?: () => Promise<unknown>
  },
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS
  const deadline = Date.now() + timeoutMs
  const interval = options.intervalMs ?? 250
  let lastError: unknown
  let attempts = 0
  while (Date.now() < deadline) {
    try {
      attempts += 1
      const value = await probe()
      if (value) return value
    } catch (err) {
      // A bail is not a transient failure: the subject settled somewhere the
      // caller was not waiting for, so retrying cannot change the answer.
      if (err instanceof WaitBailedError) throw err
      lastError = err
    }
    await new Promise((r) => setTimeout(r, interval))
  }
  let observed = ''
  if (options.diagnose) {
    try {
      observed = ` (last observed: ${JSON.stringify(await options.diagnose())})`
    } catch (err) {
      observed = ` (diagnose failed: ${String(err)})`
    }
  }
  throw new Error(
    `waitFor timed out after ${timeoutMs}ms across ${attempts} probe(s): ${options.description}` +
      (lastError ? ` (last error: ${String(lastError)})` : '') +
      observed,
  )
}
