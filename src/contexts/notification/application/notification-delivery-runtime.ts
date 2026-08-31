// Notification context — delivery runtime.
//
// ARC-03-T12: the worker's email/notification delivery jobs, the Resend webhook
// and the notification-gap healing sweep used to be assembled in the
// composition root out of Notification's private repository trio plus three
// loose handlers. This names the whole delivery surface as ONE
// Notification-owned capability, so the root forwards a capability rather than
// reaching through a context-private hatch.
//
// The parts stay generic on purpose: their concrete types are inferred from the
// build's own wiring, and restating the use-case signatures here would create a
// second declaration that drifts from the first.

type RuntimeParts = Readonly<Record<string, unknown>>

export function createNotificationDeliveryRuntime<
  TRepos extends RuntimeParts,
  THandlers extends RuntimeParts,
>(
  input: Readonly<{
    /** Persistence the worker's delivery jobs bind directly (BQC-3 job wiring). */
    repos: TRepos
    /**
     * Webhook ingestion, audience authorization and the sweep that heals what
     * the best-effort in-process bus path drops. Individual handlers stay
     * undefined without a job queue, exactly as before the extraction.
     */
    handlers: THandlers
  }>,
): Readonly<{ repos: Readonly<TRepos> }> & Readonly<THandlers> {
  return Object.freeze({
    repos: Object.freeze({ ...input.repos }),
    ...input.handlers,
  })
}
