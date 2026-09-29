// The Google reconnect email is about the Organization's connection, filed
// under a Property that is only its delivery anchor and that its copy never
// names. Its one-click unsubscribe used to record that anchor's
// urgent_operational scope, so one click in a mail client silently turned off
// every urgent email for a Property the message never mentioned. The mail
// client's unsubscribe now opens the preferences page instead of acting.

import { beforeEach, describe, expect, it } from 'vitest'
import { createUrgentEmailJobHandler } from './urgent-email.job'
import { buildNotification } from './test-fixtures'
import { BASE_URL, fakeDeps, job, PROPERTY } from './urgent-email-job-test-deps'

describe('the Google reconnect email', () => {
  let deps: ReturnType<typeof fakeDeps>

  beforeEach(() => {
    deps = fakeDeps()
    deps.notifRepo.findByIdForProperty.mockResolvedValue(
      buildNotification({
        propertyId: PROPERTY as string,
        type: 'integration.reauthorization_required',
        category: 'urgent_operational',
        priority: 'urgent',
        resourceType: 'integration',
        resourceId: 'connection-1',
        payload: { reauthorizationCause: 'provider_revoked' },
      }),
    )
  })

  const run = () =>
    createUrgentEmailJobHandler(
      deps as unknown as Parameters<typeof createUrgentEmailJobHandler>[0],
    )(job)

  it('offers the preferences page, never a one-click switch for its anchor', async () => {
    await run()

    const headers = deps.emailSender.send.mock.calls[0]![0].headers
    expect(headers).toEqual({
      'List-Unsubscribe': `<${BASE_URL}/settings/notifications?propertyId=${PROPERTY as string}>`,
    })
    expect(deps.oneClickUnsubscribeUrl).not.toHaveBeenCalled()
  })

  it('records no unsubscribe scope for the anchor Property', async () => {
    await run()

    expect(deps.emailSender.send).toHaveBeenCalledOnce()
    expect(deps.emailRepo.recordEmailUnsubscribeScope).not.toHaveBeenCalled()
  })
})
