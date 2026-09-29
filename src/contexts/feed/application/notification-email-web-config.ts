// What the web service needs for notification email, checked once at boot.
//
// The worker refuses to start without what sending needs. The web service
// serves the product and must not refuse to start over email, but two email
// seams live only here: the Resend event webhook, and the RFC 8058 endpoint.
// Unconfigured, each answers 503 to every request, and that used to show only
// as a per-request warning: production ran for weeks with live mail and no
// provider feedback at all. Outside production nothing is reported; a local
// stack runs without them on purpose.

import { oneClickUnsubscribeKeyringProblem } from './one-click-unsubscribe-token'

const WEBHOOK_SECRET_UNSET =
  'RESEND_WEBHOOK_SECRET is unset: provider events are refused (503), so delivery, bounce, complaint and suppression outcomes are never recorded'

function unsubscribeKeysProblem(rawKeys: string | undefined): string | null {
  if (rawKeys === undefined) {
    return 'NOTIFICATION_UNSUBSCRIBE_HMAC_KEYS is unset: one-click unsubscribe answers 503'
  }
  const problem = oneClickUnsubscribeKeyringProblem(rawKeys)
  return problem === null
    ? null
    : `NOTIFICATION_UNSUBSCRIBE_HMAC_KEYS is unusable (${problem}): one-click unsubscribe answers 503`
}

/** Each problem as an operator-facing sentence; never a configured value. */
export function notificationEmailWebConfigProblems(
  input: Readonly<{
    production: boolean
    sendEmailEnabled: boolean
    webhookSecret: string | undefined
    unsubscribeKeys: string | undefined
  }>,
): readonly string[] {
  if (!input.production || !input.sendEmailEnabled) return []
  const keysProblem = unsubscribeKeysProblem(input.unsubscribeKeys)
  return [
    ...(input.webhookSecret ? [] : [WEBHOOK_SECRET_UNSET]),
    ...(keysProblem === null ? [] : [keysProblem]),
  ]
}
