// BQC-7.4 — alert dispatch.
//
// The AlertDispatcher port + the default production implementation. Two
// destinations:
//
//   1. A schema-conformant structured ALERT log at error level (always) —
//      the fields are exactly the AlertEvent contract plus firedAt; all
//      content-free (no 7.3 banned keys; the injection suite walks every
//      dispatched field through isBannedLogKey).
//   2. An optional operator webhook POST when ALERT_WEBHOOK_URL is set —
//      the payload IS the log payload (one redaction surface), 3s timeout,
//      fire-and-log-on-failure.
//
// Dispatch NEVER throws into the evaluator path: webhook failures degrade
// to a warn log. The error-level log line is the durable signal — the
// webhook is best-effort operator wiring on top.

import type pino from 'pino'
import type { AlertEvent } from './alert-definitions'

/** Webhook delivery budget — an alert POST must never stall the job. */
const ALERT_WEBHOOK_TIMEOUT_MS = 3000

export type AlertDispatcher = Readonly<{
  dispatch: (event: AlertEvent) => Promise<void>
}>

/** Narrow fetch surface (typeof fetch satisfies it structurally). */
export type AlertFetchFn = (
  url: string,
  init: Readonly<{
    method: string
    headers: Record<string, string>
    body: string
    signal: AbortSignal
  }>,
) => Promise<Readonly<{ ok: boolean; status?: number }>>

export type AlertDispatcherDeps = Readonly<{
  logger: pino.Logger
  clock: () => Date
  /**
   * Optional operator webhook (env ALERT_WEBHOOK_URL — the BQC-7.4 wiring
   * point; absent = log-only dispatch, which is the always-on substrate).
   */
  webhookUrl?: string
  /** Injectable for tests; defaults to the global fetch. */
  fetchFn?: AlertFetchFn
  /** Webhook delivery budget (tests shrink it). */
  webhookTimeoutMs?: number
}>

/** The dispatched field set — the log line and the webhook payload are the
 *  same object, so redaction has exactly one surface. */
function toPayload(event: AlertEvent, firedAt: string): Record<string, unknown> {
  return {
    alert: event.name,
    severity: event.severity,
    owner: event.owner,
    runbook: event.runbook,
    value: event.value,
    threshold: event.threshold,
    windowMs: event.windowMs,
    detail: event.detail,
    firedAt,
  }
}

export function createAlertDispatcher(deps: AlertDispatcherDeps): AlertDispatcher {
  const fetchFn = (deps.fetchFn ?? fetch) as unknown as AlertFetchFn

  return {
    dispatch: async (event) => {
      const payload = toPayload(event, deps.clock().toISOString())
      deps.logger.error(payload, `[alert] ${event.name} firing (${event.severity})`)

      if (!deps.webhookUrl || !fetchFn) return
      try {
        const res = await fetchFn(deps.webhookUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(deps.webhookTimeoutMs ?? ALERT_WEBHOOK_TIMEOUT_MS),
        })
        if (!res.ok) {
          deps.logger.warn(
            { alert: event.name, status: res.status ?? 0 },
            '[alert] webhook delivery failed (non-2xx) — log line is the durable record',
          )
        }
      } catch (err) {
        deps.logger.warn(
          { err, alert: event.name },
          '[alert] webhook delivery failed — log line is the durable record',
        )
      }
    },
  }
}
