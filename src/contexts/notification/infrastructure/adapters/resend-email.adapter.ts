// Resend adapter for the EmailSenderPort
// Wraps the Resend SDK in a testable, port-compliant function.
import { Resend } from 'resend'
import { getEnv } from '#/shared/config/env'
import { getLogger } from '#/shared/observability/logger'
import { maskEmail } from '#/shared/observability/pii'
import { notificationError } from '../../domain/errors'

export const createResendEmailAdapter = () => {
  let resend: Resend | undefined

  function getResend(): Resend {
    if (!resend) {
      const env = getEnv()
      resend = new Resend(env.RESEND_API_KEY)
    }
    return resend
  }

  return {
    async send(params: { to: string; subject: string; html: string }): Promise<void> {
      const logger = getLogger()
      const client = getResend()

      const { error } = await client.emails.send({
        from: 'Reputation Key <info@kodes.agency>',
        to: params.to,
        subject: params.subject,
        html: params.html,
      })

      if (error) {
        logger.error(
          { error, toPrefix: maskEmail(params.to), subject: params.subject },
          `Failed to send email: ${params.subject}`,
        )
        throw notificationError(
          'email_send_failed',
          'Email provider rejected the message',
          {
            subject: params.subject,
          },
        )
      }

      logger.info(
        { toPrefix: maskEmail(params.to), subject: params.subject },
        'Email sent',
      )
    },
  }
}
