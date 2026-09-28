// A sweep that reads as many recipients as its cap allows may have left some
// unread. That used to be silent; at scale it is the first sign that some
// recipients are not being visited in their 08:00 hour.

import { describe, expect, it } from 'vitest'
import { DUE_RECIPIENT_SWEEP_CAP } from '../repositories/notification-due-recipients.query'
import { baseDeps, ORG, runHandler } from './digest-job-test-deps'

const recipients = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    organizationId: ORG,
    userId: `capped-user-${index}`,
  }))

const CAP_MESSAGE = 'Digest sweep read as many recipients as its cap allows'

describe('the digest sweep recipient cap', () => {
  it('warns when a sweep reads a full cap of recipients', async () => {
    const deps = baseDeps({
      recipients: recipients(DUE_RECIPIENT_SWEEP_CAP),
      dueByUser: [],
    })

    await runHandler(deps)

    expect(deps.logger.warn).toHaveBeenCalledWith(
      { recipients: DUE_RECIPIENT_SWEEP_CAP, cap: DUE_RECIPIENT_SWEEP_CAP },
      CAP_MESSAGE,
    )
  })

  it('stays quiet below the cap', async () => {
    const deps = baseDeps({ recipients: recipients(3), dueByUser: [] })

    await runHandler(deps)

    expect(deps.logger.warn).not.toHaveBeenCalledWith(expect.anything(), CAP_MESSAGE)
  })
})
