// The worker's outbound transport for notification email, chosen once at boot
// and logged loudly: "email silently went nowhere" is the most expensive thing
// for this subsystem to be ambiguous about.
//
// It lives here rather than inline in bootstrap so that the choice, including
// the production refusal, is exercised by tests exactly as the worker makes
// it. The rules themselves are in shared/email/transport-selection.ts.

import type { LoggerPort } from '#/shared/domain/logger.port'
import {
  assertEmailTransportAdmitted,
  decideEmailTransport,
} from '#/shared/email/transport-selection'
import type { EmailSenderPort } from '../../application/ports/email-sender.port'
import { createCapturingEmailSender } from './capturing-email-sender.adapter'
import { createResendEmailAdapter } from './resend-email.adapter'

export type NotificationEmailTransportConfig = Readonly<{
  nodeEnv: string
  resendApiKey: string
  resendBaseUrl?: string
  emailFrom: string
  appBaseUrl: string
}>

export type NotificationEmailSenderDeps = Readonly<{
  transport: NotificationEmailTransportConfig
  /** Whether this process admits `notification.send_email` work at all. */
  outboundEmailEnabled: boolean
  logger: LoggerPort
  clock: () => Date
}>

export const createNotificationEmailSender = (
  deps: NotificationEmailSenderDeps,
): EmailSenderPort => {
  const { transport, logger } = deps
  const decision = decideEmailTransport({
    NODE_ENV: transport.nodeEnv,
    RESEND_API_KEY: transport.resendApiKey,
    ...(transport.resendBaseUrl ? { RESEND_BASE_URL: transport.resendBaseUrl } : {}),
  })
  assertEmailTransportAdmitted(decision, {
    NODE_ENV: transport.nodeEnv,
    outboundEmailEnabled: deps.outboundEmailEnabled,
  })

  if (decision.mode === 'capture') {
    logger.warn(
      { transport: 'capture', reason: decision.reason },
      'NOTIFICATION EMAIL IS BEING CAPTURED, NOT SENT — no message will reach a recipient',
    )
    return createCapturingEmailSender({ clock: deps.clock })
  }
  logger.info(
    { transport: 'send', reason: decision.reason },
    'notification email will be delivered through Resend',
  )
  return createResendEmailAdapter({
    config: {
      apiKey: transport.resendApiKey,
      ...(transport.resendBaseUrl ? { baseUrl: transport.resendBaseUrl } : {}),
      from: transport.emailFrom,
      appBaseUrl: transport.appBaseUrl,
    },
    logger,
    clock: deps.clock,
  })
}
