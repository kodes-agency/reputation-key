import { describe, expect, it } from 'vitest'
import { guestSessionId, organizationId } from '#/shared/domain/ids'
import { GuestResponseLifecycleError } from './guest-response-lifecycle.server'
import { isQualifiedGuestResponse } from './contracts'
import {
  SESSION,
  harness,
  registerLifecycleSuiteHooks,
} from './guest-response-lifecycle.test-fixtures'

registerLifecycleSuiteHooks()

/** A network-volume or honeypot filter, as the guest integrity layer reports it. */
const filteredAssessment = (reasonCode: string, actorId: string) =>
  ({
    outcome: 'filtered_automatically',
    reasonCode,
    source: 'automatic',
    actorId,
  }) as const

describe('guest response lifecycle', () => {
  it('copies initial Staff attribution through later correction facts without re-resolving', async () => {
    const test = await harness()
    const sessionId = guestSessionId('00000000-0000-4000-8000-000000000099')

    await test.lifecycle.submit(test.scope, sessionId, { rating: 5 }, 3)
    test.setStaffAttribution({
      staffParticipantId: '20000000-0000-4000-8000-000000000001',
      staffParticipationId: '20000000-0000-4000-8000-000000000002',
      portalResponsibilityId: '20000000-0000-4000-8000-000000000003',
      effectiveFrom: new Date('2026-08-09T12:00:00.001Z'),
      effectiveTo: null,
    })

    await test.lifecycle.correct(test.scope, sessionId, {
      rating: 4,
    })

    const serializedAttribution = JSON.parse(JSON.stringify(test.staffAttribution))
    expect(test.staffAttributionResolutionCount()).toBe(1)
    expect((await test.stored()).staffAttribution).toEqual(test.staffAttribution)
    expect(await test.outbox.byTag('guest.rating.submitted')).toMatchObject([
      { staffAttribution: serializedAttribution },
      { staffAttribution: serializedAttribution },
    ])
  })

  it('pins exact session expiry separately from the 24-month fact deadline', async () => {
    const { scope, lifecycle, stored, snapshot } = await harness()
    const sessionId = SESSION
    const sessionExpiresAt = new Date('2026-08-10T12:00:00.000Z')

    await lifecycle.submit(scope, sessionId, { rating: 5 }, 3)

    expect(await stored()).toMatchObject({
      sessionId,
      sessionExpiresAt,
      retentionDeadline: new Date('2028-08-09T12:00:00.000Z'),
      experienceSnapshot: {
        portalPublicationState: 'published',
        portalPublicationSnapshotId: snapshot,
        portalPublicationVersion: 1,
        portalPublicationDigest: 'b'.repeat(64),
        portalConfigurationDigest: 'a'.repeat(64),
        guestLocale: 'en',
        languagePackVersion: 'guest-ui-en-v1',
        privateFeedbackThreshold: 3,
        capturedAt: new Date('2026-08-09T12:00:00.000Z'),
      },
    })
  })

  it.each([
    { portalPublicationState: 'disabled' },
    { portalConfigurationDigest: 'not-a-digest' },
    { guestLocale: 'en--US' },
    { languagePackVersion: 'Guest UI V1' },
    { privateFeedbackThreshold: 0 },
    { privateFeedbackThreshold: 6 },
  ])('rejects an invalid server-resolved experience: %o', async (override) => {
    const { scope, experience, rawLifecycle, count } = await harness()
    await expect(
      rawLifecycle.submit(scope, SESSION, { rating: 5 }, {
        ...experience(),
        ...override,
      } as Parameters<typeof rawLifecycle.submit>[3]),
    ).rejects.toMatchObject({ code: 'response_unavailable' })
    expect(await count()).toBe(0)
  })

  it('retains an automatically filtered submission without recording a rating fact', async () => {
    const { scope, experience, rawLifecycle, stored, outbox } = await harness()
    const receipt = await rawLifecycle.submit(
      scope,
      SESSION,
      { rating: 5 },
      experience(),
      filteredAssessment('honeypot_signal', 'guest-integrity-honeypot-v1'),
    )

    expect(receipt).toMatchObject({ status: 'submitted', rating: 5 })
    expect(receipt).not.toHaveProperty('integrityOutcome')
    expect(await stored()).toMatchObject({
      rating: 5,
      integrityOutcome: 'filtered_automatically',
      ratingSourceEventId: null,
    })
    expect(await outbox.byTag('guest.rating.submitted')).toHaveLength(0)
  })

  it('keeps a rating filtered for network volume: durable, in the normal view, out of the figures', async () => {
    // A venue's guests share one public address, so a rating past the network
    // layer's budget is kept and filtered automatically instead of refused.
    const { scope, experience, rawLifecycle, stored, outbox } = await harness()
    const sessionId = SESSION
    const receipt = await rawLifecycle.submit(
      scope,
      sessionId,
      { rating: 4 },
      experience(),
      filteredAssessment('network_volume', 'guest-integrity-network-v1'),
    )

    expect(receipt).toMatchObject({ status: 'submitted', rating: 4 })
    expect(receipt).not.toHaveProperty('integrityOutcome')
    expect(await stored()).toMatchObject({
      rating: 4,
      integrityOutcome: 'filtered_automatically',
      integrityReasonCode: 'network_volume',
      ratingSourceEventId: null,
    })
    expect(await outbox.byTag('guest.rating.submitted')).toHaveLength(0)
    // Durable: the guest's session now holds a rating, so the Google step opens.
    expect(isQualifiedGuestResponse(await rawLifecycle.getState(scope, sessionId))).toBe(
      true,
    )
  })

  it('answers a network-volume rating exactly as an accepted one, and lets the guest go on', async () => {
    // The guest on a busy venue's Wi-Fi must get the page an accepted rating gets,
    // and a script crossing the budget must learn nothing from the answer.
    const sessionId = SESSION
    const input = { rating: 2 }
    const accepted = await harness()
    const filtered = await harness()

    const acceptedView = await accepted.rawLifecycle.submit(
      accepted.scope,
      sessionId,
      input,
      accepted.experience(),
    )
    const filteredView = await filtered.rawLifecycle.submit(
      filtered.scope,
      sessionId,
      input,
      filtered.experience(),
      filteredAssessment('network_volume', 'guest-integrity-network-v1'),
    )
    expect(filteredView).toEqual(acceptedView)
    expect(filteredView.privateFeedbackEligible).toBe(true)

    // The one correction and the private note both go through; the rating
    // still records no reading, and the note reaches the manager.
    await expect(
      filtered.rawLifecycle.correct(filtered.scope, sessionId, { rating: 1 }),
    ).resolves.toMatchObject({ status: 'corrected', rating: 1 })
    await expect(
      filtered.rawLifecycle.addPrivateFeedback(filtered.scope, sessionId, {
        text: 'The lobby Wi-Fi kept dropping.',
        textConsent: true,
      }),
    ).resolves.toMatchObject({ hasPrivateFeedback: true })
    expect(await filtered.outbox.byTag('guest.rating.submitted')).toHaveLength(0)
    expect(await filtered.outbox.byTag('guest.rating.retracted')).toHaveLength(0)
    expect(await filtered.outbox.byTag('guest.feedback.submitted')).toHaveLength(1)
  })

  it('submits, corrects once, and withdraws only for the same session', async () => {
    const { scope, lifecycle } = await harness()
    const submitted = await lifecycle.submit(scope, SESSION, {
      rating: 5,
    })
    expect(submitted.status).toBe('submitted')
    expect(submitted.correctionAvailable).toBe(true)
    const corrected = await lifecycle.correct(scope, SESSION, { rating: 4 })
    expect(corrected.status).toBe('corrected')
    expect(corrected.correctionAvailable).toBe(false)
    await expect(
      lifecycle.correct(scope, SESSION, {
        rating: 3,
      }),
    ).rejects.toMatchObject({ code: 'already_submitted' })
    await expect(
      lifecycle.withdraw(scope, guestSessionId('00000000-0000-4000-8000-000000000099')),
    ).rejects.toBeInstanceOf(GuestResponseLifecycleError)
    const withdrawn = await lifecycle.withdraw(scope, SESSION)
    expect(withdrawn).toMatchObject({ status: 'deleted', rating: null })
    expect('text' in withdrawn).toBe(false)
  })

  it('stops advertising correction at the exact one-hour boundary plus one millisecond', async () => {
    let now = new Date('2026-08-09T12:00:00.000Z')
    const { scope, lifecycle } = await harness(() => now)
    const sessionId = SESSION
    await lifecycle.submit(scope, sessionId, { rating: 5 })

    now = new Date('2026-08-09T13:00:00.000Z')
    await expect(lifecycle.getState(scope, sessionId)).resolves.toMatchObject({
      correctionAvailable: true,
    })

    now = new Date('2026-08-09T13:00:00.001Z')
    await expect(lifecycle.getState(scope, sessionId)).resolves.toMatchObject({
      correctionAvailable: false,
    })
  })

  it('rejects another tenant without revealing the response', async () => {
    const { scope, lifecycle } = await harness()
    const sessionId = SESSION
    await lifecycle.submit(scope, sessionId, { rating: 5 })
    await expect(
      lifecycle.withdraw(
        { ...scope, organizationId: organizationId('org-2') },
        sessionId,
      ),
    ).rejects.toMatchObject({ code: 'response_not_found' })
  })

  it('excludes an anomaly from metrics, preserves its rating, and restores the corrected value', async () => {
    let now = new Date('2026-08-09T12:00:00.000Z')
    const { scope, lifecycle, stored, outbox } = await harness(() => now)
    const sessionId = SESSION
    await lifecycle.submit(scope, sessionId, { rating: 2 })
    const responseId = (await stored()).id
    const original = (await outbox.byTag('guest.rating.submitted'))[0]!

    now = new Date('2026-08-09T12:10:00.000Z')
    await expect(
      lifecycle.changeIntegrity(scope, responseId, {
        outcome: 'under_review',
        reasonCode: 'traffic_velocity_anomaly',
        source: 'automatic',
        actorId: 'guest-integrity-v1',
      }),
    ).resolves.toMatchObject({
      revision: 2,
      previousOutcome: 'accepted',
      outcome: 'under_review',
    })
    expect(await stored()).toMatchObject({
      rating: 2,
      integrityOutcome: 'under_review',
      ratingSourceEventId: null,
    })
    expect(await outbox.byTag('guest.rating.retracted')).toMatchObject([
      { supersedesSourceEventId: original.eventId },
    ])

    now = new Date('2026-08-09T12:20:00.000Z')
    await lifecycle.correct(scope, sessionId, { rating: 4 })
    expect(await stored()).toMatchObject({
      rating: 4,
      integrityOutcome: 'under_review',
      ratingSourceEventId: null,
    })
    expect(await outbox.byTag('guest.rating.submitted')).toHaveLength(1)

    now = new Date('2026-08-09T12:30:00.000Z')
    await lifecycle.changeIntegrity(scope, responseId, {
      outcome: 'accepted',
      reasonCode: 'reviewer_restored',
      source: 'reviewer',
      actorId: 'reviewer-1',
    })
    expect(await stored()).toMatchObject({
      rating: 4,
      integrityOutcome: 'accepted',
      integrityRevision: 3,
    })
    expect(await outbox.byTag('guest.rating.submitted')).toHaveLength(2)
    expect((await outbox.byTag('guest.rating.submitted'))[1]).toMatchObject({
      value: 4,
      supersedesSourceEventId: null,
      occurredAt: '2026-08-09T12:20:00.000Z',
    })
  })
})
