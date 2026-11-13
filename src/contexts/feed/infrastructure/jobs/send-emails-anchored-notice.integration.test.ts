// The Google reconnect email is about the Organization's connection, filed
// under a Property that is only its delivery anchor and that its copy never
// names. Its one-click unsubscribe used to record that anchor's
// urgent_operational scope, so one click in a mail client silently turned off
// every urgent email for a Property the message never mentioned. The mail
// client's unsubscribe now opens the preferences page instead of acting.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BASE_URL,
  PROPERTY,
  openSendWorld,
  type SendWorld,
} from './send-emails-test-deps'

let world: SendWorld
let deps: ReturnType<SendWorld['deps']>

beforeEach(async () => {
  world = await openSendWorld({
    notice: {
      type: 'integration.reauthorization_required',
      resourceType: 'integration',
      resourceId: 'connection-1',
      payload: { reauthorizationCause: 'provider_revoked' },
    },
  })
  deps = world.deps()
})

afterEach(async () => {
  await world.rollBack()
})

describe('the Google reconnect email', () => {
  it('offers the preferences page, never a one-click switch for its anchor', async () => {
    await world.run(deps)

    const headers = deps.emailSender.send.mock.calls[0]![0].headers
    expect(headers).toEqual({
      'List-Unsubscribe': `<${BASE_URL}/settings/notifications?propertyId=${PROPERTY}>`,
    })
    expect(deps.oneClickUnsubscribeUrl).not.toHaveBeenCalled()
  })

  it('records no unsubscribe scope for the anchor Property', async () => {
    await world.run(deps)

    expect(deps.emailSender.send).toHaveBeenCalledOnce()
    expect(await world.unsubscribeScopes()).toEqual([])
  })
})
