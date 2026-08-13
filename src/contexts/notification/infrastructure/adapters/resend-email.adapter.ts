// Resend adapter for the EmailSenderPort
// Wraps the Resend SDK in a testable, port-compliant function.
import { Resend } from 'resend'
import { getEnv } from '#/shared/config/env'
import { getLogger } from '#/shared/observability/logger'
import { maskEmail } from '#/shared/observability/pii'
import type { EmailSenderPort } from '../../application/ports/email-sender.port'
import { classifyProviderRejection } from '../../domain/notification-delivery-policy'

export const createResendEmailAdapter = (): EmailSenderPort => {
  let resend: Resend | undefined

  function getResend(): Resend {
    if (!resend) {
      const env = getEnv()
      resend = new Resend(env.RESEND_API_KEY)
    }
    return resend
  }

  return {
    async send(params: {
      to: string
      subject: string
      html: string
      idempotencyKey: string
    }) {
      const logger = getLogger()
      const client = getResend()
      const acceptedAt = new Date()
      const { data, error } = await client.emails.send(
        {
          from: 'Reputation Key <info@kodes.agency>',
          to: params.to,
          subject: params.subject,
          html: params.html,
        },
        { idempotencyKey: params.idempotencyKey },
      )

      if (error || !data?.id) {
        const statusCode =
          error && 'statusCode' in error && typeof error.statusCode === 'number'
            ? error.statusCode
            : null
        const providerCode =
          error && 'name' in error && typeof error.name === 'string' ? error.name : null
        const classification = classifyProviderRejection({
          statusCode,
          providerCode,
          message: error?.message ?? '',
        })
        logger.error(
          { toPrefix: maskEmail(params.to), providerCode, statusCode, classification },
          'Email provider rejected message',
        )
        return { kind: 'rejected' as const, classification, providerCode }
      }

      logger.info(
        { toPrefix: maskEmail(params.to), providerMessageId: data.id },
        'Email provider accepted message',
      )
      return {
        kind: 'accepted' as const,
        providerMessageId: data.id,
        acceptedAt,
      }
    },
  }
}
