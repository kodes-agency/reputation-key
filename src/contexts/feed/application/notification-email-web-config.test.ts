// Production sent live mail while the web service had no RESEND_WEBHOOK_SECRET:
// every provider event was answered 503, so no bounce, complaint or provider
// suppression was ever recorded, and the only sign was a per-request warning
// and an alert that needs three unresolved messages. The web boot now says so.

import { describe, expect, it } from 'vitest'
import { notificationEmailWebConfigProblems } from './notification-email-web-config'

const KEYS = `v1:${'11'.repeat(32)}`
const configured = {
  production: true,
  sendEmailEnabled: true,
  webhookSecret: 'whsec_c2VjcmV0',
  unsubscribeKeys: KEYS,
} as const

describe('notificationEmailWebConfigProblems', () => {
  it('finds nothing wrong with a configured web service', () => {
    expect(notificationEmailWebConfigProblems(configured)).toEqual([])
  })

  it('names a missing webhook secret while production sends email', () => {
    expect(
      notificationEmailWebConfigProblems({ ...configured, webhookSecret: undefined }),
    ).toEqual([
      'RESEND_WEBHOOK_SECRET is unset: provider events are refused (503), so delivery, bounce, complaint and suppression outcomes are never recorded',
    ])
  })

  it('names an unusable unsubscribe keyring without echoing it', () => {
    const problems = notificationEmailWebConfigProblems({
      ...configured,
      unsubscribeKeys: '11'.repeat(32),
    })

    expect(problems).toEqual([
      'NOTIFICATION_UNSUBSCRIBE_HMAC_KEYS is unusable (HMAC keyring entry is malformed): one-click unsubscribe answers 503',
    ])
  })

  it('stays quiet while email is off or outside production', () => {
    const unset = { webhookSecret: undefined, unsubscribeKeys: undefined }
    expect(
      notificationEmailWebConfigProblems({
        ...configured,
        ...unset,
        sendEmailEnabled: false,
      }),
    ).toEqual([])
    expect(
      notificationEmailWebConfigProblems({ ...configured, ...unset, production: false }),
    ).toEqual([])
  })
})
