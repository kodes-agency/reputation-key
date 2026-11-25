import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import {
  SESSION,
  harness,
  registerLifecycleSuiteHooks,
} from './guest-response-lifecycle.test-fixtures'

const db = getDb()

registerLifecycleSuiteHooks()

// The submit path is the only producer of the guest rating/feedback facts the
// metric handlers consume (portal.rating, portal.feedback). These pin the
// producer: without them both metrics silently read 0 again.
describe('guest response lifecycle — submitted facts', () => {
  it('records rating then feedback facts from the two staged commands', async () => {
    const { scope, lifecycle, outbox, stored } = await harness()

    await lifecycle.submit(scope, SESSION, {
      rating: 2,
    })
    const withFeedback = await lifecycle.addPrivateFeedback(scope, SESSION, {
      text: 'Please follow up with the property team.',
      textConsent: true,
    })
    const responseId = (await stored()).id

    expect(await outbox.byTag('guest.rating.submitted')).toMatchObject([
      {
        ratingId: responseId,
        organizationId: scope.organizationId,
        portalId: scope.portalId,
        propertyId: scope.propertyId,
        value: 2,
      },
    ])
    expect(await outbox.byTag('guest.feedback.submitted')).toMatchObject([
      { feedbackId: responseId, ratingId: responseId, responseRevision: 1 },
    ])
    expect(withFeedback).toMatchObject({
      hasPrivateFeedback: true,
      privateFeedbackEligible: false,
    })
    expect('text' in withFeedback).toBe(false)
  })

  it('records no feedback fact when the guest supplied no free text', async () => {
    const { scope, lifecycle, outbox } = await harness()

    await lifecycle.submit(scope, SESSION, { rating: 5 })

    expect(await outbox.byTag('guest.rating.submitted')).toHaveLength(1)
    expect(await outbox.byTag('guest.feedback.submitted')).toHaveLength(0)
  })

  it('renews recovery for 24 hours from late feedback without duplicating it', async () => {
    let now = new Date('2026-08-09T12:00:00.000Z')
    const { scope, lifecycle, outbox, stored } = await harness(() => now)
    await lifecycle.submit(scope, SESSION, { rating: 2 })
    now = new Date('2026-08-10T11:00:00.000Z')

    await lifecycle.addPrivateFeedback(scope, SESSION, {
      text: 'Late but still within the original recovery session.',
      textConsent: true,
    })
    expect((await stored()).sessionExpiresAt).toEqual(
      new Date('2026-08-11T11:00:00.000Z'),
    )
    await expect(
      lifecycle.addPrivateFeedback(scope, SESSION, {
        text: 'A replay must not overwrite the original.',
        textConsent: true,
      }),
    ).resolves.toMatchObject({ hasPrivateFeedback: true })
    expect((await stored()).text).toBe(
      'Late but still within the original recovery session.',
    )
    expect(await outbox.byTag('guest.feedback.submitted')).toHaveLength(1)
  })

  it('records nothing for a repeated submit of the same session', async () => {
    const { scope, lifecycle, outbox } = await harness()
    const input = { rating: 3 }

    await lifecycle.submit(scope, SESSION, input)
    await lifecycle.submit(scope, SESSION, input)

    expect(await outbox.byTag('guest.rating.submitted')).toHaveLength(1)
  })

  it('records a superseding fact for a corrected rating', async () => {
    const { scope, lifecycle, outbox } = await harness()
    await lifecycle.submit(scope, SESSION, { rating: 3 })
    const original = (await outbox.byTag('guest.rating.submitted'))[0]!

    await lifecycle.correct(scope, SESSION, { rating: 1 })

    expect(await outbox.byTag('guest.rating.submitted')).toMatchObject([
      { value: 3 },
      { value: 1, supersedesSourceEventId: original.eventId },
    ])
  })

  it('fails closed when historical shared content has no recoverable fact lineage', async () => {
    const { scope, lifecycle, outbox } = await harness()
    await lifecycle.submit(scope, SESSION, { rating: 3 })
    await db.execute(
      sql`UPDATE guest_responses SET rating_source_event_id = NULL WHERE organization_id = ${scope.organizationId}`,
    )

    await expect(lifecycle.correct(scope, SESSION, { rating: 1 })).rejects.toMatchObject({
      code: 'response_unavailable',
    })
    await expect(lifecycle.withdraw(scope, SESSION)).rejects.toMatchObject({
      code: 'response_unavailable',
    })
    expect(await outbox.byTag('guest.rating.submitted')).toHaveLength(1)
    expect(await outbox.byTag('guest.rating.retracted')).toHaveLength(0)
  })

  it('records a retraction for a withdrawn rating', async () => {
    const { scope, lifecycle, outbox } = await harness()
    await lifecycle.submit(scope, SESSION, { rating: 3 })
    const original = (await outbox.byTag('guest.rating.submitted'))[0]!

    await lifecycle.withdraw(scope, SESSION)

    expect(await outbox.byTag('guest.rating.retracted')).toMatchObject([
      { ratingId: original.ratingId, supersedesSourceEventId: original.eventId },
    ])
  })

  it('retracts private-feedback count independently during withdrawal', async () => {
    const { scope, lifecycle, outbox } = await harness()
    await lifecycle.submit(scope, SESSION, {
      rating: 2,
    })
    await lifecycle.addPrivateFeedback(scope, SESSION, {
      text: 'Please follow up.',
      textConsent: true,
    })
    const original = (await outbox.byTag('guest.feedback.submitted'))[0]!

    await lifecycle.withdraw(scope, SESSION)

    expect(await outbox.byTag('guest.feedback.retracted')).toMatchObject([
      { feedbackId: original.feedbackId, supersedesSourceEventId: original.eventId },
    ])
  })

  it('withdraws private feedback without retracting the rating', async () => {
    const { scope, lifecycle, outbox, stored } = await harness()
    await lifecycle.submit(scope, SESSION, {
      rating: 2,
    })
    await lifecycle.addPrivateFeedback(scope, SESSION, {
      text: 'Please follow up.',
      textConsent: true,
    })
    const ratingFact = (await outbox.byTag('guest.rating.submitted'))[0]!
    const feedbackFact = (await outbox.byTag('guest.feedback.submitted'))[0]!

    const receipt = await lifecycle.withdrawPrivateFeedback(scope, SESSION)

    expect(receipt).toMatchObject({
      status: 'submitted',
      rating: 2,
      hasPrivateFeedback: false,
      privateFeedbackEligible: false,
      feedbackSubmittedAt: '2026-08-09T12:00:00.000Z',
      feedbackWithdrawnAt: '2026-08-09T12:00:00.000Z',
    })
    expect(await stored()).toMatchObject({
      rating: 2,
      text: null,
      feedbackSourceEventId: null,
    })
    expect(await outbox.byTag('guest.feedback.retracted')).toMatchObject([
      {
        feedbackId: feedbackFact.feedbackId,
        supersedesSourceEventId: feedbackFact.eventId,
      },
    ])
    expect(await outbox.byTag('guest.rating.retracted')).toHaveLength(0)
    expect(await outbox.byTag('guest.rating.submitted')).toEqual([ratingFact])

    await expect(lifecycle.withdrawPrivateFeedback(scope, SESSION)).resolves.toEqual(
      receipt,
    )
    expect(await outbox.byTag('guest.feedback.retracted')).toHaveLength(1)
  })

  it('rejects private-feedback withdrawal after 24 hours without changing data', async () => {
    let now = new Date('2026-08-09T12:00:00.000Z')
    const { scope, lifecycle, outbox, stored, keepSessionBound } = await harness(
      () => now,
    )
    await lifecycle.submit(scope, SESSION, { rating: 2 })
    await lifecycle.addPrivateFeedback(scope, SESSION, {
      text: 'Please follow up.',
      textConsent: true,
    })
    await keepSessionBound()
    now = new Date('2026-08-10T12:00:00.001Z')

    await expect(lifecycle.withdrawPrivateFeedback(scope, SESSION)).rejects.toMatchObject(
      { code: 'feedback_withdrawal_expired' },
    )
    expect(await stored()).toMatchObject({
      rating: 2,
      text: 'Please follow up.',
      feedbackWithdrawnAt: null,
    })
    expect(await outbox.byTag('guest.feedback.retracted')).toHaveLength(0)
  })

  it('rejects whole-response withdrawal after 24 hours without retracting rating', async () => {
    let now = new Date('2026-08-09T12:00:00.000Z')
    const { scope, lifecycle, outbox, stored, keepSessionBound } = await harness(
      () => now,
    )
    await lifecycle.submit(scope, SESSION, { rating: 4 })
    await keepSessionBound()
    now = new Date('2026-08-10T12:00:00.001Z')

    await expect(lifecycle.withdraw(scope, SESSION)).rejects.toMatchObject({
      code: 'response_withdrawal_expired',
    })
    expect(await stored()).toMatchObject({ status: 'submitted', rating: 4 })
    expect(await outbox.byTag('guest.rating.retracted')).toHaveLength(0)
  })

  it('uses the snapshotted inclusive threshold and never returns feedback text', async () => {
    const eligible = await harness()
    const low = await eligible.lifecycle.submit(eligible.scope, SESSION, { rating: 3 }, 3)
    expect(low.privateFeedbackEligible).toBe(true)
    const receipt = await eligible.lifecycle.addPrivateFeedback(eligible.scope, SESSION, {
      text: 'A private note for the manager.',
      textConsent: true,
    })
    expect(receipt).toMatchObject({
      hasPrivateFeedback: true,
      privateFeedbackEligible: false,
    })
    expect('text' in receipt).toBe(false)
    for (const internalField of [
      'id',
      'organizationId',
      'propertyId',
      'portalId',
      'sessionId',
      'category',
      'responseConsent',
      'textConsent',
      'mediaConsent',
    ]) {
      expect(receipt).not.toHaveProperty(internalField)
    }

    const ineligible = await harness()
    const high = await ineligible.lifecycle.submit(
      ineligible.scope,
      SESSION,
      { rating: 4 },
      3,
    )
    expect(high.privateFeedbackEligible).toBe(false)
    await expect(
      ineligible.lifecycle.addPrivateFeedback(ineligible.scope, SESSION, {
        text: 'Not eligible',
        textConsent: true,
      }),
    ).rejects.toMatchObject({ code: 'feedback_not_eligible' })
  })

  it.each([1, 2, 3, 4, 5])(
    'treats %i as inclusive for its captured threshold',
    async (threshold) => {
      const { scope, lifecycle } = await harness()
      const receipt = await lifecycle.submit(
        scope,
        SESSION,
        { rating: threshold },
        threshold,
      )
      expect(receipt.privateFeedbackEligible).toBe(true)
    },
  )

  it('unlocks feedback after a high-to-low correction without spending another correction', async () => {
    const { scope, lifecycle, stored, outbox } = await harness()
    await lifecycle.submit(scope, SESSION, { rating: 5 }, 3)
    const corrected = await lifecycle.correct(scope, SESSION, { rating: 2 })
    expect(corrected.privateFeedbackEligible).toBe(true)

    await lifecycle.addPrivateFeedback(scope, SESSION, {
      text: 'Now eligible after correction.',
      textConsent: true,
    })
    expect(await stored()).toMatchObject({
      correctionCount: 1,
      rating: 2,
      text: 'Now eligible after correction.',
      feedbackSubmissionRevision: 2,
    })
    expect(await outbox.byTag('guest.feedback.submitted')).toMatchObject([
      { responseRevision: 2 },
    ])
  })
})
