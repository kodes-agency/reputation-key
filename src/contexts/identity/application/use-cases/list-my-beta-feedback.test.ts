// Identity context — list my beta feedback use case tests.

import { describe, expect, it, vi } from 'vitest'
import { betaFeedbackPseudonym } from '../beta-feedback-pseudonym'
import type { BetaFeedbackReporterItem } from '../ports/beta-feedback-submission.port'
import { listMyBetaFeedback } from './list-my-beta-feedback'

const SECRET = 'beta-feedback-test-secret'
const NOW = new Date('2026-08-28T08:00:00.000Z')

const report: BetaFeedbackReporterItem = {
  reference: '00000000-0000-4000-8000-0000000000f1',
  feedbackType: 'bug',
  impactCode: 'cannot_complete',
  routeKey: 'properties.property.reviews',
  deliveryState: 'delivered',
  triageState: 'accepted',
  engineeringIssueRef: '472',
  createdAt: NOW,
  updatedAt: NOW,
}

describe('listMyBetaFeedback', () => {
  it("reads only the reporter's own reports, by their telemetry pseudonym", async () => {
    const store = { listForActor: vi.fn().mockResolvedValue([report]) }
    const listMine = listMyBetaFeedback({ store, hmacSecret: SECRET })

    await expect(listMine({ actor: { userId: 'user-1' } })).resolves.toEqual([report])

    // The scoping is the authorization: no other identifier reaches the query.
    expect(store.listForActor).toHaveBeenCalledTimes(1)
    expect(store.listForActor).toHaveBeenCalledWith(
      betaFeedbackPseudonym(SECRET, 'telemetry-actor', 'user-1'),
    )
  })
})
