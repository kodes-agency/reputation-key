// Resend adapter for the EmailSenderPort
// Wraps the Resend SDK in a testable, port-compliant function.
import { Resend } from 'resend'
import { getEnv } from '#/shared/config/env'
import { getLogger } from '#/shared/observability/logger'

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return '***'
  return `${local.slice(0, 1)}***@${domain}`
}

export function createResendEmailAdapter() {
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
        throw new Error(`Failed to send email: ${error.message}`)
      }

      logger.info(
        { toPrefix: maskEmail(params.to), subject: params.subject },
        'Email sent',
      )
    },
  }
}
