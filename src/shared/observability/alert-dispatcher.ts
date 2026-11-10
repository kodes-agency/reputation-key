// BQC-7.4 — alert dispatch.
//
// The AlertDispatcher port + the default production implementation. Three
// destinations:
//
//   1. A schema-conformant structured ALERT log at error level (always) —
//      the fields are exactly the AlertEvent contract plus firedAt; all
//      content-free (no 7.3 banned keys; the injection suite walks every
//      dispatched field through isBannedLogKey).
//   2. The injected error-monitoring sink for P1/P2 alerts.
//   3. An optional operator webhook POST when ALERT_WEBHOOK_URL is set —
//      the payload IS the log payload (one redaction surface), 3s timeout,
//      one retry, then log on failure.
//
// Dispatch never throws for webhook delivery failures: they degrade to a warn
// log. The error-level log remains the durable signal; the error-monitoring and
// webhook sinks are operator notification wiring on top.

import type pino from 'pino'
import type { AlertEvent } from './alert-definitions'

/** Webhook delivery budget — an alert POST must never stall the job. */
const ALERT_WEBHOOK_TIMEOUT_MS = 3000

/** One retry: a transient webhook failure must not lose the operator copy. */
const ALERT_WEBHOOK_ATTEMPTS = 2

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
  /** Forward P1/P2 alerts to the configured error-monitoring sink. */
  report?: (event: AlertEvent) => void
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

  async function postWebhook(
    url: string,
    event: AlertEvent,
    payload: Record<string, unknown>,
  ): Promise<void> {
    for (let attempt = 1; attempt <= ALERT_WEBHOOK_ATTEMPTS; attempt++) {
      const isLastAttempt = attempt === ALERT_WEBHOOK_ATTEMPTS
      try {
        const res = await fetchFn(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(deps.webhookTimeoutMs ?? ALERT_WEBHOOK_TIMEOUT_MS),
        })
        if (res.ok) return
        if (isLastAttempt) {
          deps.logger.warn(
            { alert: event.name, status: res.status ?? 0 },
            '[alert] webhook delivery failed (non-2xx) — log line is the durable record',
          )
        }
      } catch (err) {
        if (isLastAttempt) {
          deps.logger.warn(
            { err, alert: event.name },
            '[alert] webhook delivery failed — log line is the durable record',
          )
        }
      }
    }
  }

  return {
    dispatch: async (event) => {
      const payload = toPayload(event, deps.clock().toISOString())
      deps.logger.error(payload, `[alert] ${event.name} firing (${event.severity})`)
      // The sinks are independent: a failing error monitor must not stop the
      // webhook, and a failing webhook must not stop the error monitor.
      if (event.severity === 'P1' || event.severity === 'P2') {
        try {
          deps.report?.(event)
        } catch (err) {
          deps.logger.warn(
            { err, alert: event.name },
            '[alert] error-monitoring report failed — log line is the durable record',
          )
        }
      }

      if (!deps.webhookUrl || !fetchFn) return
      await postWebhook(deps.webhookUrl, event, payload)
    },
  }
}
