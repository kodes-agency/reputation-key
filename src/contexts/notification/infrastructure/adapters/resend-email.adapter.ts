// Resend adapter for the EmailSenderPort
// Wraps the Resend SDK in a testable, port-compliant function.
//
// Three seams this adapter must honour, all of which it previously did not:
//
//  1. RESEND_BASE_URL (env.ts) is the documented operator sandbox seam. Identity
//     mail already honours it (`shared/auth/emails.ts:28-30`); notification mail
//     did not, so a sandbox/e2e deployment pointed at a mail stub still shipped
//     real notification email to real inboxes. Absent → the SDK default, which
//     is byte-identical to the pre-seam behavior.
//  2. EMAIL_FROM (env.ts) replaces the hardcoded sender, so a deployment on a
//     different verified domain does not need a code change.
//  3. `text` and `headers` reach the provider. `headers` carries the ADR 0046
//     r.7 List-Unsubscribe pair; dropping it silently would make the guard in
//     the jobs decorative.
//
// The client is injectable so the adapter is unit-testable without network or a
// live key. Production callers use the zero-arg form.
import { Resend } from 'resend'
import { maskEmail } from '#/shared/observability/pii'
import { warnOnceOnSenderMisalignment } from '#/shared/email'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type {
  EmailSenderPort,
  EmailSendRequest,
} from '../../application/ports/email-sender.port'
import { classifyProviderRejection } from '../../domain/notification-delivery-policy'

/** What this adapter hands Resend — the whole port payload, nothing dropped. */
export type ResendSendPayload = Readonly<{
  from: string
  to: string
  subject: string
  html: string
  text: string
  headers?: Readonly<Record<string, string>>
}>

/** Resend's `{ data, error }` answer, narrowed to what classification needs. */
export type ResendSendResult = Readonly<{
  data: Readonly<{ id: string }> | null
  error: Readonly<{ message?: string; name?: string; statusCode?: number }> | null
}>

/** The single Resend SDK surface this adapter touches. */
export type ResendEmailClient = Readonly<{
  emails: Readonly<{
    send: (
      payload: ResendSendPayload,
      options: Readonly<{ idempotencyKey: string }>,
    ) => Promise<ResendSendResult>
  }>
}>

export type ResendEmailAdapterConfig = Readonly<{
  apiKey: string
  baseUrl?: string
  from: string
  appBaseUrl: string
}>

export type ResendEmailAdapterDependencies = Readonly<{
  config: ResendEmailAdapterConfig
  logger: LoggerPort
  clock: () => Date
  clientFactory?: () => ResendEmailClient
}>

const buildClient = (config: ResendEmailAdapterConfig): ResendEmailClient => {
  // RESEND_BASE_URL absent → SDK default (https://api.resend.com).
  const client = config.baseUrl
    ? new Resend(config.apiKey, { baseUrl: config.baseUrl })
    : new Resend(config.apiKey)
  return client as unknown as ResendEmailClient
}

export const createResendEmailAdapter = (
  dependencies: ResendEmailAdapterDependencies,
): EmailSenderPort => {
  let client: ResendEmailClient | undefined
  const getClient = (): ResendEmailClient =>
    (client ??= (
      dependencies.clientFactory ?? (() => buildClient(dependencies.config))
    )())

  return {
    async send(params: EmailSendRequest) {
      const acceptedAt = dependencies.clock()

      // Notification mail is the high-volume path, and the worker has no boot
      // hook shared with the web process, so the sender-alignment check is
      // latched here too. It warns at most once per process, not per message.
      warnOnceOnSenderMisalignment(
        dependencies.config.from,
        dependencies.config.appBaseUrl,
        (fields, message) => dependencies.logger.warn(fields, message),
      )

      const { data, error } = await getClient().emails.send(
        {
          from: dependencies.config.from,
          to: params.to,
          subject: params.subject,
          html: params.html,
          text: params.text,
          ...(params.headers ? { headers: params.headers } : {}),
        },
        { idempotencyKey: params.idempotencyKey },
      )

      if (error || !data?.id) {
        const statusCode = typeof error?.statusCode === 'number' ? error.statusCode : null
        const providerCode = typeof error?.name === 'string' ? error.name : null
        const classification = classifyProviderRejection({
          statusCode,
          providerCode,
          message: error?.message ?? '',
        })
        dependencies.logger.error(
          { toPrefix: maskEmail(params.to), providerCode, statusCode, classification },
          'Email provider rejected message',
        )
        return { kind: 'rejected' as const, classification, providerCode }
      }

      dependencies.logger.info(
        { toPrefix: maskEmail(params.to), providerMessageId: data.id },
        'Email provider accepted message',
      )
      return { kind: 'accepted' as const, providerMessageId: data.id, acceptedAt }
    },
  }
}
