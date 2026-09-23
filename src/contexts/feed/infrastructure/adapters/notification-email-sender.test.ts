// The worker's outbound-email wiring, exercised as bootstrap calls it.
//
// Before this, bootstrap wired the capturing sender whenever the key looked
// like a placeholder and only logged a warning — including in production with
// notification email admitted. Capture reports every send as accepted, so the
// database said urgent mail and digests went out while nothing reached anyone.

import { describe, expect, it } from 'vitest'
import { createFakeJobLogger } from '../jobs/test-fixtures'
import { createNotificationEmailSender } from './notification-email-sender'

const CLOCK = () => new Date('2026-09-22T08:00:00.000Z')
const LIVE_KEY = 're_A1b2C3d4E5f6G7h8I9j0'

const transport = (overrides: Partial<{ nodeEnv: string; resendApiKey: string }>) => ({
  nodeEnv: overrides.nodeEnv ?? 'production',
  resendApiKey: overrides.resendApiKey ?? LIVE_KEY,
  emailFrom: 'Reputation Key <notifications@test.example>',
  appBaseUrl: 'https://app.test',
})

describe('notification email sender wiring', () => {
  it('refuses to boot a production worker that would capture admitted mail', () => {
    expect(() =>
      createNotificationEmailSender({
        transport: transport({ resendApiKey: 're_xxxxxxxxxxxx' }),
        outboundEmailEnabled: true,
        logger: createFakeJobLogger(),
        clock: CLOCK,
      }),
    ).toThrow(/notification email would be captured, not sent/)
  })

  it('still boots a production worker whose outbound email is not enabled', () => {
    const logger = createFakeJobLogger()

    createNotificationEmailSender({
      transport: transport({ resendApiKey: 're_xxxxxxxxxxxx' }),
      outboundEmailEnabled: false,
      logger,
      clock: CLOCK,
    })

    expect(logger.warn).toHaveBeenCalledWith(
      { transport: 'capture', reason: 'placeholder_key' },
      expect.stringContaining('CAPTURED, NOT SENT'),
    )
  })

  it('captures in development and says so loudly', async () => {
    const logger = createFakeJobLogger()

    const sender = createNotificationEmailSender({
      transport: transport({ nodeEnv: 'development', resendApiKey: 're_xxxxxxxxxxxx' }),
      outboundEmailEnabled: true,
      logger,
      clock: CLOCK,
    })

    await expect(
      sender.send({
        to: 'manager@example.com',
        subject: 'Approve a reply',
        html: '<p>Approve a reply</p>',
        text: 'Approve a reply',
        idempotencyKey: 'notification-1:email',
      }),
    ).resolves.toMatchObject({ kind: 'accepted', providerMessageId: 'captured-1' })
    expect(logger.warn).toHaveBeenCalledWith(
      { transport: 'capture', reason: 'placeholder_key' },
      expect.stringContaining('CAPTURED, NOT SENT'),
    )
  })

  it('delivers through Resend in production with a live key', () => {
    const logger = createFakeJobLogger()

    createNotificationEmailSender({
      transport: transport({}),
      outboundEmailEnabled: true,
      logger,
      clock: CLOCK,
    })

    expect(logger.info).toHaveBeenCalledWith(
      { transport: 'send', reason: 'live_key' },
      'notification email will be delivered through Resend',
    )
  })
})
