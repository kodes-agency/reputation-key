// Identity context — submit beta feedback use case tests.

import { describe, expect, it, vi } from 'vitest'
import type { BetaFeedbackInput } from '#/shared/beta-feedback-contract'
import { betaFeedbackPseudonym } from '../beta-feedback-pseudonym'
import type {
  BetaFeedbackDelivery,
  BetaFeedbackTriageRecord,
} from '../ports/beta-feedback-submission.port'
import { submitBetaFeedback } from './submit-beta-feedback'

const SECRET = 'beta-feedback-test-secret'
const REFERENCE = '00000000-0000-4000-8000-0000000000f1'
const NOW = new Date('2026-08-28T08:00:00.000Z')
const PROVIDER_REFERENCE = 'a'.repeat(32)

const actor = {
  organizationId: 'organization-1',
  userId: 'user-1',
  role: 'PropertyManager',
} as const

const bug: BetaFeedbackInput = {
  kind: 'bug',
  impact: 'cannot_complete',
  clientErrorEventId: null,
  maskedLayout: null,
  message: 'The reviews page did not load.',
  routePath: '/properties/property-1/reviews',
  viewport: 'wide',
}

function setup(delivery: ReturnType<BetaFeedbackDelivery>) {
  const row = { revision: 0 } as unknown as BetaFeedbackTriageRecord
  const store = {
    prepare: vi.fn().mockResolvedValue(row),
    markDelivered: vi.fn().mockResolvedValue(row),
    markFailed: vi.fn().mockResolvedValue(row),
  }
  const deliver = vi.fn<BetaFeedbackDelivery>().mockReturnValue(delivery)
  const submit = submitBetaFeedback({
    store,
    deliver,
    clock: () => NOW,
    idGen: () => REFERENCE,
    hmacSecret: SECRET,
  })
  return { store, deliver, submit }
}

describe('submitBetaFeedback', () => {
  it('prepares the pseudonymous row, delivers, then settles it delivered at revision 0', async () => {
    const { store, deliver, submit } = setup({
      status: 'delivered',
      providerReference: PROVIDER_REFERENCE,
    })

    await expect(submit({ actor, data: bug })).resolves.toEqual({ reference: REFERENCE })

    expect(store.prepare).toHaveBeenCalledWith({
      reference: REFERENCE,
      organizationPseudonym: betaFeedbackPseudonym(
        SECRET,
        'telemetry-organization',
        actor.organizationId,
      ),
      actorPseudonym: betaFeedbackPseudonym(SECRET, 'telemetry-actor', actor.userId),
      feedbackType: 'bug',
      impactCode: 'cannot_complete',
      routeKey: 'properties.property.reviews',
      viewport: 'wide',
      reporterRole: 'PropertyManager',
      clientErrorEventId: null,
      attachmentKind: 'none',
      attachmentCapturedAt: null,
      attachmentExpiresAt: null,
      maskedLayout: null,
      now: NOW,
    })
    expect(deliver).toHaveBeenCalledWith({
      data: bug,
      actor,
      hmacSecret: SECRET,
      reference: REFERENCE,
    })
    expect(store.markDelivered).toHaveBeenCalledWith({
      reference: REFERENCE,
      providerReference: PROVIDER_REFERENCE,
      expectedRevision: 0,
      now: NOW,
    })
    expect(store.markFailed).not.toHaveBeenCalled()
    // Nothing leaves the server before the durable row exists.
    expect(store.prepare.mock.invocationCallOrder[0]).toBeLessThan(
      deliver.mock.invocationCallOrder[0]!,
    )
  })

  it('records a failed delivery and asks the reporter to retry', async () => {
    const { store, submit } = setup({
      status: 'failed',
      failureCode: 'monitoring_unavailable',
    })

    await expect(submit({ actor, data: bug })).rejects.toMatchObject({
      _tag: 'BetaFeedbackError',
      code: 'temporarily_unavailable',
      message: 'Beta feedback is temporarily unavailable. Please try again later.',
    })
    expect(store.markFailed).toHaveBeenCalledWith({
      reference: REFERENCE,
      failureCode: 'monitoring_unavailable',
      expectedRevision: 0,
      now: NOW,
    })
    expect(store.markDelivered).not.toHaveBeenCalled()
  })

  it('stamps the masked layout retention from the server clock, not the browser', async () => {
    const { store, submit } = setup({
      status: 'delivered',
      providerReference: PROVIDER_REFERENCE,
    })
    const maskedLayout = {
      width: 1280,
      height: 800,
      boxes: [{ x: 0, y: 0, w: 320, h: 48, role: 'heading' as const }],
    }

    await submit({ actor, data: { ...bug, maskedLayout } })

    expect(store.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentKind: 'masked_layout_v1',
        attachmentCapturedAt: NOW,
        // Exactly the accepted 30-day horizon from the injected clock.
        attachmentExpiresAt: new Date('2026-09-27T08:00:00.000Z'),
        maskedLayout,
      }),
    )
  })

  it('does not deliver when the durable triage row cannot be prepared', async () => {
    const { store, deliver, submit } = setup({
      status: 'delivered',
      providerReference: PROVIDER_REFERENCE,
    })
    const outage = new Error('database unavailable')
    store.prepare.mockRejectedValue(outage)

    await expect(submit({ actor, data: bug })).rejects.toBe(outage)
    expect(deliver).not.toHaveBeenCalled()
    expect(store.markDelivered).not.toHaveBeenCalled()
    expect(store.markFailed).not.toHaveBeenCalled()
  })
})
