// The join key for the email delivery pipeline's log trail.
//
// `correlationId` is one of exactly two approved correlation fields in log
// objects (`shared/observability/metrics-schema.ts`: APPROVED_CORRELATION_FIELDS
// = requestId, correlationId). Every tenant/entity identifier — including
// `notificationEmailId` and `eventId` — is in BANNED_LOG_KEYS, enforced by the
// call-site scan in `shared/architecture/observability-schema.test.ts`.
//
// So the delivery pipeline gets ONE opaque correlation string, and it must be
// the SAME string the job envelopes already stamp (`bootstrap.ts` and
// `contexts/notification/build.ts` both use `notification-email:${id}`).
// Matching it is the whole point: the enqueue log, the suppression log, the
// provider-rejection log, the sweep re-enqueue, and the webhook state change
// then join on a single grep.

/** `notification-email:<id>` — the queue row's log identity. */
export function emailCorrelationId(notificationEmailId: string): string {
  return `notification-email:${notificationEmailId}`
}

/** `resend-event:<svix-id>` — a provider webhook delivery's log identity. */
export function providerEventCorrelationId(svixId: string): string {
  return `resend-event:${svixId}`
}
