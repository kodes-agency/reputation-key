import { describe, expect, it } from 'vitest'
import type { StoragePort } from '#/contexts/portal/application/ports/storage.port'
import type { GuestMedia } from '../../domain/guest-media'
import type { GuestResponse } from '../../domain/guest-response'
import type {
  GuestResponseRepository,
  GuestResponseScope,
} from '../ports/guest-response.repository'
import {
  GuestResponseLifecycleError,
  guestResponseLifecycle,
} from './guest-response-lifecycle'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'

const scope: GuestResponseScope = {
  organizationId: 'org-1',
  propertyId: '00000000-0000-4000-8000-000000000001',
  portalId: '00000000-0000-4000-8000-000000000002',
}

function memoryRepo(): GuestResponseRepository & {
  responses: GuestResponse[]
  media: GuestMedia[]
} {
  const responses: GuestResponse[] = []
  const media: GuestMedia[] = []
  const sameScope = (candidate: GuestResponseScope, row: GuestResponse | GuestMedia) =>
    candidate.organizationId === row.organizationId &&
    candidate.propertyId === row.propertyId &&
    candidate.portalId === row.portalId
  return {
    responses,
    media,
    findForSession: async (candidate, sessionId) =>
      responses.find((row) => sameScope(candidate, row) && row.sessionId === sessionId) ??
      null,
    findById: async (candidate, responseId) =>
      responses.find((row) => sameScope(candidate, row) && row.id === responseId) ?? null,
    findSnippetForOrg: async (organizationId, responseId) => {
      const row = responses.find(
        (candidate) =>
          candidate.organizationId === organizationId && candidate.id === responseId,
      )
      if (!row) return null
      return {
        comment: row.textConsent && row.status !== 'moderated' ? row.text : null,
        ratingValue: row.responseConsent ? row.rating : null,
      }
    },
    findSnippetsForOrg: async () => [],
    findEligibleSnippetIdsForOrg: async () => [],
    saveModeration: async (response) => {
      const index = responses.findIndex((row) => row.id === response.id)
      if (index < 0) return false
      responses[index] = response
      for (let mediaIndex = 0; mediaIndex < media.length; mediaIndex += 1) {
        if (media[mediaIndex].responseId === response.id) {
          media[mediaIndex] = {
            ...media[mediaIndex],
            status: 'quarantined',
            processingLease: null,
            publicUrl: null,
          }
        }
      }
      return true
    },
    insertMedia: async (item) => {
      media.push(item)
      return true
    },
    findMediaForSession: async (candidate, sessionId, mediaId) =>
      media.find(
        (row) =>
          sameScope(candidate, row) && row.sessionId === sessionId && row.id === mediaId,
      ) ?? null,
    claimMedia: async (item, lease, now) => {
      const index = media.findIndex(
        (row) => row.id === item.id && row.status === 'issued',
      )
      const response = responses.find((row) => row.id === item.responseId)
      if (
        index < 0 ||
        !response ||
        response.status === 'deleted' ||
        !response.mediaConsent
      ) {
        return false
      }
      media[index] = {
        ...media[index],
        status: 'processing',
        processingLease: lease,
        processingStartedAt: now,
        confirmedAt: now,
      }
      return true
    },
    completeMedia: async (item, lease, publicUrl, now) => {
      const index = media.findIndex(
        (row) =>
          row.id === item.id &&
          row.status === 'processing' &&
          row.processingLease === lease,
      )
      const response = responses.find((row) => row.id === item.responseId)
      if (index < 0 || !response || response.status === 'deleted') return false
      media[index] = {
        ...media[index],
        status: 'ready',
        processingLease: null,
        publicUrl,
        readyAt: now,
      }
      return true
    },
    queueMediaPurge: async (item, now) => {
      const index = media.findIndex((row) => row.id === item.id)
      if (index >= 0) {
        media[index] = {
          ...media[index],
          status: 'purge_pending',
          processingLease: null,
          publicUrl: null,
          deletedAt: now,
        }
      }
    },
    markMediaDeleted: async (candidate, objectKey, now) => {
      const index = media.findIndex(
        (row) => sameScope(candidate, row) && row.objectKey === objectKey,
      )
      if (index >= 0)
        media[index] = { ...media[index], status: 'deleted', deletedAt: now }
    },
  }
}

function harness(clock: () => Date = () => new Date('2026-08-09T12:00:00Z')) {
  const repo = memoryRepo()
  let sequence = 10
  let confirm: (() => Promise<string>) | undefined
  let inspect:
    (() => Promise<{ contentType: string | null; sizeBytes: number | null }>) | undefined
  const storage: StoragePort = {
    createPresignedUploadUrl: async (key) => ({
      uploadUrl: `https://upload.invalid/${key}`,
      key,
    }),
    confirmUpload: async () =>
      confirm ? confirm() : 'https://objects.invalid/guest-response.webp',
    inspectObject: async () =>
      inspect
        ? inspect()
        : {
            contentType: repo.media[0]?.contentType ?? null,
            sizeBytes: repo.media[0]?.declaredSizeBytes ?? null,
          },
    deleteObject: async () => {},
    getPublicUrl: (key) => `https://objects.invalid/${key}`,
    putObject: async () => {},
  }
  const events = createCapturingEventBus()
  const commandStore = {
    commitSubmitted: async (
      response: GuestResponse,
      facts: Parameters<
        import('../ports/guest-response-command-store.port').GuestResponseCommandStore['commitSubmitted']
      >[1],
    ) => {
      if (
        repo.responses.some(
          (row) =>
            row.organizationId === response.organizationId &&
            row.portalId === response.portalId &&
            row.sessionId === response.sessionId,
        )
      ) {
        return 'duplicate' as const
      }
      const ratingFact = facts.find((fact) => fact._tag === 'guest.rating.submitted')
      const feedbackFact = facts.find((fact) => fact._tag === 'guest.feedback.submitted')
      repo.responses.push({
        ...response,
        ratingSourceEventId: ratingFact?.eventId ?? null,
        feedbackSourceEventId: feedbackFact?.eventId ?? null,
      })
      for (const fact of facts) await events.emit(fact)
      return 'applied' as const
    },
    commitCorrected: async (
      previous: GuestResponse,
      response: GuestResponse,
      facts: Parameters<
        import('../ports/guest-response-command-store.port').GuestResponseCommandStore['commitCorrected']
      >[2],
    ) => {
      const index = repo.responses.findIndex(
        (row) =>
          row.id === response.id &&
          row.status === previous.status &&
          row.correctionCount === previous.correctionCount &&
          row.ratingSourceEventId === previous.ratingSourceEventId &&
          row.feedbackSourceEventId === previous.feedbackSourceEventId,
      )
      if (index < 0) return 'conflict' as const
      const ratingFact = facts.find(
        (fact) =>
          fact._tag === 'guest.rating.submitted' ||
          fact._tag === 'guest.rating.retracted',
      )
      const feedbackFact = facts.find(
        (fact) =>
          fact._tag === 'guest.feedback.submitted' ||
          fact._tag === 'guest.feedback.retracted',
      )
      repo.responses[index] = {
        ...response,
        ratingSourceEventId:
          ratingFact?._tag === 'guest.rating.submitted'
            ? ratingFact.eventId
            : ratingFact?._tag === 'guest.rating.retracted'
              ? null
              : response.ratingSourceEventId,
        feedbackSourceEventId:
          feedbackFact?._tag === 'guest.feedback.submitted'
            ? feedbackFact.eventId
            : feedbackFact?._tag === 'guest.feedback.retracted'
              ? null
              : response.feedbackSourceEventId,
      }
      for (const fact of facts) await events.emit(fact)
      return 'applied' as const
    },
    commitFeedbackAdded: async (
      response: GuestResponse,
      fact: Parameters<
        import('../ports/guest-response-command-store.port').GuestResponseCommandStore['commitFeedbackAdded']
      >[1],
    ) => {
      const index = repo.responses.findIndex(
        (row) =>
          row.id === response.id &&
          row.text === null &&
          row.feedbackSourceEventId === null,
      )
      if (index < 0) return 'conflict' as const
      repo.responses[index] = {
        ...response,
        feedbackSourceEventId: fact.eventId,
      }
      await events.emit(fact)
      return 'applied' as const
    },
    commitFeedbackWithdrawn: async (
      previous: GuestResponse,
      response: GuestResponse,
      fact: Parameters<
        import('../ports/guest-response-command-store.port').GuestResponseCommandStore['commitFeedbackWithdrawn']
      >[2],
    ) => {
      const index = repo.responses.findIndex(
        (row) =>
          row.id === previous.id &&
          row.status === previous.status &&
          row.ratingSourceEventId === previous.ratingSourceEventId &&
          row.feedbackSourceEventId === previous.feedbackSourceEventId &&
          row.text === previous.text &&
          row.feedbackWithdrawnAt === null,
      )
      if (index < 0) return 'conflict' as const
      repo.responses[index] = { ...response, feedbackSourceEventId: null }
      await events.emit(fact)
      return 'applied' as const
    },
    commitWithdrawn: async (
      response: GuestResponse,
      facts: Parameters<
        import('../ports/guest-response-command-store.port').GuestResponseCommandStore['commitWithdrawn']
      >[1],
    ) => {
      const index = repo.responses.findIndex((row) => row.id === response.id)
      if (index < 0) {
        return { outcome: 'conflict' as const, objectKeys: [] as const }
      }
      repo.responses[index] = {
        ...response,
        ratingSourceEventId: null,
        feedbackSourceEventId: null,
      }
      const objectKeys = repo.media
        .filter((item) => item.responseId === response.id && item.status !== 'deleted')
        .map((item) => {
          const mediaIndex = repo.media.indexOf(item)
          repo.media[mediaIndex] = {
            ...item,
            status: 'purge_pending',
            processingLease: null,
            publicUrl: null,
            deletedAt: response.deletedAt,
          }
          return item.objectKey
        })
      for (const fact of facts) await events.emit(fact)
      return { outcome: 'applied' as const, objectKeys }
    },
  }
  const lifecycle = guestResponseLifecycle({
    repo,
    storage,
    clock,
    idGen: () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`,
    commandStore,
  })
  return {
    repo,
    events,
    lifecycle,
    setConfirm: (value: () => Promise<string>) => (confirm = value),
    setInspect: (
      value: () => Promise<{ contentType: string | null; sizeBytes: number | null }>,
    ) => (inspect = value),
  }
}

describe('guest response lifecycle', () => {
  it('pins exact session expiry separately from the 24-month fact deadline', async () => {
    const { lifecycle, repo } = harness()
    const sessionId = '00000000-0000-4000-8000-000000000003'
    const sessionExpiresAt = new Date('2026-08-10T12:00:00.000Z')

    await lifecycle.submit(
      scope,
      sessionId,
      { rating: 5, responseConsent: true },
      3,
      sessionExpiresAt,
    )

    expect(repo.responses[0]).toMatchObject({
      sessionId,
      sessionExpiresAt,
      retentionDeadline: new Date('2028-08-09T12:00:00.000Z'),
    })
  })

  it('rejects expired or overlong recovery bindings', async () => {
    const { lifecycle } = harness()
    const sessionId = '00000000-0000-4000-8000-000000000003'
    for (const expiresAt of [
      new Date('2026-08-09T12:00:00.000Z'),
      new Date('2026-08-10T12:00:00.001Z'),
    ]) {
      await expect(
        lifecycle.submit(
          scope,
          sessionId,
          { rating: 5, responseConsent: true },
          3,
          expiresAt,
        ),
      ).rejects.toMatchObject({ code: 'response_unavailable' })
    }
  })

  it('submits, corrects once, and withdraws only for the same session', async () => {
    const { lifecycle } = harness()
    const submitted = await lifecycle.submit(
      scope,
      '00000000-0000-4000-8000-000000000003',
      {
        rating: 5,
        responseConsent: true,
      },
    )
    expect(submitted.status).toBe('submitted')
    expect(submitted.correctionAvailable).toBe(true)
    const corrected = await lifecycle.correct(
      scope,
      '00000000-0000-4000-8000-000000000003',
      { rating: 4 },
    )
    expect(corrected.status).toBe('corrected')
    expect(corrected.correctionAvailable).toBe(false)
    await expect(
      lifecycle.correct(scope, '00000000-0000-4000-8000-000000000003', {
        rating: 3,
      }),
    ).rejects.toMatchObject({ code: 'already_submitted' })
    await expect(
      lifecycle.withdraw(scope, '00000000-0000-4000-8000-000000000099'),
    ).rejects.toBeInstanceOf(GuestResponseLifecycleError)
    const withdrawn = await lifecycle.withdraw(
      scope,
      '00000000-0000-4000-8000-000000000003',
    )
    expect(withdrawn).toMatchObject({ status: 'deleted', rating: null })
    expect('text' in withdrawn).toBe(false)
  })

  it('stops advertising correction at the exact one-hour boundary plus one millisecond', async () => {
    let now = new Date('2026-08-09T12:00:00.000Z')
    const { lifecycle } = harness(() => now)
    const sessionId = '00000000-0000-4000-8000-000000000003'
    await lifecycle.submit(scope, sessionId, { rating: 5, responseConsent: true })

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
    const { lifecycle } = harness()
    const sessionId = '00000000-0000-4000-8000-000000000003'
    await lifecycle.submit(scope, sessionId, { rating: 5, responseConsent: true })
    await expect(
      lifecycle.withdraw({ ...scope, organizationId: 'org-2' }, sessionId),
    ).rejects.toMatchObject({ code: 'response_not_found' })
  })

  it('persists terminal purge when withdrawal wins object confirmation', async () => {
    const { lifecycle, repo, setConfirm } = harness()
    const sessionId = '00000000-0000-4000-8000-000000000003'
    await lifecycle.submit(scope, sessionId, {
      rating: 5,
      responseConsent: true,
      mediaConsent: true,
    })
    const issuance = await lifecycle.issueMedia(scope, sessionId, {
      contentType: 'image/webp',
      sizeBytes: 1024,
    })
    const gate = Promise.withResolvers<string>()
    setConfirm(() => gate.promise)
    const confirming = lifecycle.confirmMedia(scope, sessionId, issuance)
    await Promise.resolve()
    await lifecycle.withdraw(scope, sessionId)
    gate.resolve('https://objects.invalid/final.webp')
    await expect(confirming).rejects.toMatchObject({ code: 'media_not_processable' })
    expect(repo.media[0]).toMatchObject({ status: 'deleted', publicUrl: null })
  })

  it('purges an object whose observed MIME differs from its issuance', async () => {
    const { lifecycle, repo, setInspect } = harness()
    const sessionId = '00000000-0000-4000-8000-000000000003'
    await lifecycle.submit(scope, sessionId, {
      rating: 5,
      responseConsent: true,
      mediaConsent: true,
    })
    const issuance = await lifecycle.issueMedia(scope, sessionId, {
      contentType: 'image/png',
      sizeBytes: 1024,
    })
    setInspect(async () => ({ contentType: 'image/jpeg', sizeBytes: 1024 }))
    await expect(
      lifecycle.confirmMedia(scope, sessionId, issuance),
    ).rejects.toMatchObject({ code: 'media_validation_failed' })
    expect(repo.media[0]).toMatchObject({ status: 'deleted', publicUrl: null })
  })

  it('quarantines manager-moderated media without exposing its object URL', async () => {
    const { lifecycle, repo } = harness()
    const sessionId = '00000000-0000-4000-8000-000000000003'
    await lifecycle.submit(scope, sessionId, {
      rating: 5,
      responseConsent: true,
      mediaConsent: true,
    })
    await lifecycle.issueMedia(scope, sessionId, {
      contentType: 'image/webp',
      sizeBytes: 1024,
    })
    const moderated = await lifecycle.moderate(scope, repo.responses[0]!.id, 'quarantine')
    expect(moderated.status).toBe('moderated')
    expect(repo.media[0]).toMatchObject({
      status: 'quarantined',
      publicUrl: null,
    })
  })

  it('treats legacy manager delete as moderation and preserves the numeric rating', async () => {
    const { lifecycle, repo } = harness()
    await lifecycle.submit(scope, '00000000-0000-4000-8000-000000000003', {
      rating: 1,
      responseConsent: true,
    })
    await lifecycle.addPrivateFeedback(scope, '00000000-0000-4000-8000-000000000003', {
      text: 'Abusive text',
      textConsent: true,
    })

    const responseId = repo.responses[0]!.id
    const moderated = await lifecycle.moderate(scope, responseId, 'delete')

    expect(moderated).toMatchObject({ status: 'moderated', rating: 1 })
    await expect(
      repo.findSnippetForOrg(scope.organizationId, responseId),
    ).resolves.toEqual({ comment: null, ratingValue: 1 })
  })

  // The domain rejection short-circuits the repo compare-and-set, so a replayed
  // confirmation reports WHY it was refused instead of the generic lost-race
  // code — and must leave the already-published object alone rather than purge
  // it down the failure path.
  it('refuses a replayed confirmation with the domain code and keeps the ready object', async () => {
    const { lifecycle, repo } = harness()
    const sessionId = '00000000-0000-4000-8000-000000000003'
    await lifecycle.submit(scope, sessionId, {
      rating: 5,
      responseConsent: true,
      mediaConsent: true,
    })
    const issuance = await lifecycle.issueMedia(scope, sessionId, {
      contentType: 'image/webp',
      sizeBytes: 1024,
    })
    await expect(lifecycle.confirmMedia(scope, sessionId, issuance)).resolves.toEqual({
      mediaId: issuance.mediaId,
      status: 'ready',
    })
    const published = repo.media[0]?.publicUrl

    await expect(
      lifecycle.confirmMedia(scope, sessionId, issuance),
    ).rejects.toMatchObject({ code: 'media_not_issued' })
    expect(repo.media[0]).toMatchObject({ status: 'ready', publicUrl: published })
  })

  it('refuses a confirmation naming an object key its issuance never minted', async () => {
    const { lifecycle, repo } = harness()
    const sessionId = '00000000-0000-4000-8000-000000000003'
    await lifecycle.submit(scope, sessionId, {
      rating: 5,
      responseConsent: true,
      mediaConsent: true,
    })
    const issuance = await lifecycle.issueMedia(scope, sessionId, {
      contentType: 'image/webp',
      sizeBytes: 1024,
    })

    await expect(
      lifecycle.confirmMedia(scope, sessionId, {
        mediaId: issuance.mediaId,
        objectKey: `${issuance.objectKey}x`,
      }),
    ).rejects.toMatchObject({ code: 'media_not_found' })
    expect(repo.media[0]).toMatchObject({ status: 'issued', publicUrl: null })
  })
})

// The submit path is the only producer of the guest rating/feedback facts the
// metric handlers consume (portal.rating, portal.feedback). These pin the
// producer: without them both metrics silently read 0 again.
describe('guest response lifecycle — submitted facts', () => {
  const sessionId = '00000000-0000-4000-8000-000000000003'

  it('emits rating then feedback facts from the two staged commands', async () => {
    const { lifecycle, events, repo } = harness()

    await lifecycle.submit(scope, sessionId, {
      rating: 2,
      responseConsent: true,
    })
    const withFeedback = await lifecycle.addPrivateFeedback(scope, sessionId, {
      text: 'Please follow up with the property team.',
      textConsent: true,
    })
    const responseId = repo.responses[0]!.id

    expect(events.capturedByTag('guest.rating.submitted')).toMatchObject([
      {
        ratingId: responseId,
        organizationId: scope.organizationId,
        portalId: scope.portalId,
        propertyId: scope.propertyId,
        value: 2,
      },
    ])
    expect(events.capturedByTag('guest.feedback.submitted')).toMatchObject([
      { feedbackId: responseId, ratingId: responseId },
    ])
    expect(withFeedback).toMatchObject({
      hasPrivateFeedback: true,
      privateFeedbackEligible: false,
    })
    expect('text' in withFeedback).toBe(false)
  })

  it('emits no feedback fact when the guest supplied no free text', async () => {
    const { lifecycle, events } = harness()

    await lifecycle.submit(scope, sessionId, { rating: 5, responseConsent: true })

    expect(events.capturedByTag('guest.rating.submitted')).toHaveLength(1)
    expect(events.capturedByTag('guest.feedback.submitted')).toHaveLength(0)
  })

  it('renews recovery for 24 hours from late feedback without duplicating it', async () => {
    let now = new Date('2026-08-09T12:00:00.000Z')
    const { lifecycle, events, repo } = harness(() => now)
    await lifecycle.submit(scope, sessionId, { rating: 2, responseConsent: true })
    now = new Date('2026-08-10T11:00:00.000Z')

    await lifecycle.addPrivateFeedback(scope, sessionId, {
      text: 'Late but still within the original recovery session.',
      textConsent: true,
    })
    expect(repo.responses[0]!.sessionExpiresAt).toEqual(
      new Date('2026-08-11T11:00:00.000Z'),
    )
    await expect(
      lifecycle.addPrivateFeedback(scope, sessionId, {
        text: 'A replay must not overwrite the original.',
        textConsent: true,
      }),
    ).resolves.toMatchObject({ hasPrivateFeedback: true })
    expect(repo.responses[0]!.text).toBe(
      'Late but still within the original recovery session.',
    )
    expect(events.capturedByTag('guest.feedback.submitted')).toHaveLength(1)
  })

  it('rejects feedback without the required private rating', async () => {
    const { lifecycle, events } = harness()

    await expect(
      lifecycle.submit(scope, sessionId, {
        text: 'The lobby coffee is excellent.',
        textConsent: true,
      }),
    ).rejects.toMatchObject({ code: 'rating_required' })

    expect(events.capturedByTag('guest.rating.submitted')).toHaveLength(0)
    expect(events.capturedByTag('guest.feedback.submitted')).toHaveLength(0)
  })

  it('emits nothing for a repeated submit of the same session', async () => {
    const { lifecycle, events } = harness()
    const input = { rating: 3, responseConsent: true }

    await lifecycle.submit(scope, sessionId, input)
    await lifecycle.submit(scope, sessionId, input)

    expect(events.capturedByTag('guest.rating.submitted')).toHaveLength(1)
  })

  it('emits a superseding fact for a corrected rating', async () => {
    const { lifecycle, events } = harness()
    await lifecycle.submit(scope, sessionId, { rating: 3, responseConsent: true })
    const original = events.capturedByTag('guest.rating.submitted')[0]!

    await lifecycle.correct(scope, sessionId, { rating: 1 })

    expect(events.capturedByTag('guest.rating.submitted')).toMatchObject([
      { value: 3 },
      { value: 1, supersedesSourceEventId: original.eventId },
    ])
  })

  it('fails closed when historical shared content has no recoverable fact lineage', async () => {
    const { lifecycle, events, repo } = harness()
    await lifecycle.submit(scope, sessionId, { rating: 3, responseConsent: true })
    repo.responses[0] = { ...repo.responses[0]!, ratingSourceEventId: null }

    await expect(
      lifecycle.correct(scope, sessionId, { rating: 1 }),
    ).rejects.toMatchObject({ code: 'response_unavailable' })
    await expect(lifecycle.withdraw(scope, sessionId)).rejects.toMatchObject({
      code: 'response_unavailable',
    })
    expect(events.capturedByTag('guest.rating.submitted')).toHaveLength(1)
    expect(events.capturedByTag('guest.rating.retracted')).toHaveLength(0)
  })

  it('emits a retraction for a withdrawn rating', async () => {
    const { lifecycle, events } = harness()
    await lifecycle.submit(scope, sessionId, { rating: 3, responseConsent: true })
    const original = events.capturedByTag('guest.rating.submitted')[0]!

    await lifecycle.withdraw(scope, sessionId)

    expect(events.capturedByTag('guest.rating.retracted')).toMatchObject([
      { ratingId: original.ratingId, supersedesSourceEventId: original.eventId },
    ])
  })

  it('retracts private-feedback count independently during withdrawal', async () => {
    const { lifecycle, events } = harness()
    await lifecycle.submit(scope, sessionId, {
      rating: 2,
      responseConsent: true,
    })
    await lifecycle.addPrivateFeedback(scope, sessionId, {
      text: 'Please follow up.',
      textConsent: true,
    })
    const original = events.capturedByTag('guest.feedback.submitted')[0]!

    await lifecycle.withdraw(scope, sessionId)

    expect(events.capturedByTag('guest.feedback.retracted')).toMatchObject([
      { feedbackId: original.feedbackId, supersedesSourceEventId: original.eventId },
    ])
  })

  it('withdraws private feedback without retracting the rating', async () => {
    const { lifecycle, events, repo } = harness()
    await lifecycle.submit(scope, sessionId, {
      rating: 2,
      responseConsent: true,
    })
    await lifecycle.addPrivateFeedback(scope, sessionId, {
      text: 'Please follow up.',
      textConsent: true,
    })
    const ratingFact = events.capturedByTag('guest.rating.submitted')[0]!
    const feedbackFact = events.capturedByTag('guest.feedback.submitted')[0]!

    const receipt = await lifecycle.withdrawPrivateFeedback(scope, sessionId)

    expect(receipt).toMatchObject({
      status: 'submitted',
      rating: 2,
      hasPrivateFeedback: false,
      privateFeedbackEligible: false,
      feedbackSubmittedAt: '2026-08-09T12:00:00.000Z',
      feedbackWithdrawnAt: '2026-08-09T12:00:00.000Z',
    })
    expect(repo.responses[0]).toMatchObject({
      rating: 2,
      text: null,
      feedbackSourceEventId: null,
    })
    expect(events.capturedByTag('guest.feedback.retracted')).toMatchObject([
      {
        feedbackId: feedbackFact.feedbackId,
        supersedesSourceEventId: feedbackFact.eventId,
      },
    ])
    expect(events.capturedByTag('guest.rating.retracted')).toHaveLength(0)
    expect(events.capturedByTag('guest.rating.submitted')).toEqual([ratingFact])

    await expect(lifecycle.withdrawPrivateFeedback(scope, sessionId)).resolves.toEqual(
      receipt,
    )
    expect(events.capturedByTag('guest.feedback.retracted')).toHaveLength(1)
  })

  it('rejects private-feedback withdrawal after 24 hours without changing data', async () => {
    let now = new Date('2026-08-09T12:00:00.000Z')
    const { lifecycle, events, repo } = harness(() => now)
    await lifecycle.submit(scope, sessionId, { rating: 2, responseConsent: true })
    await lifecycle.addPrivateFeedback(scope, sessionId, {
      text: 'Please follow up.',
      textConsent: true,
    })
    now = new Date('2026-08-10T12:00:00.001Z')

    await expect(
      lifecycle.withdrawPrivateFeedback(scope, sessionId),
    ).rejects.toMatchObject({ code: 'feedback_withdrawal_expired' })
    expect(repo.responses[0]).toMatchObject({
      rating: 2,
      text: 'Please follow up.',
      feedbackWithdrawnAt: null,
    })
    expect(events.capturedByTag('guest.feedback.retracted')).toHaveLength(0)
  })

  it('rejects whole-response withdrawal after 24 hours without retracting rating', async () => {
    let now = new Date('2026-08-09T12:00:00.000Z')
    const { lifecycle, events, repo } = harness(() => now)
    await lifecycle.submit(scope, sessionId, { rating: 4, responseConsent: true })
    now = new Date('2026-08-10T12:00:00.001Z')

    await expect(lifecycle.withdraw(scope, sessionId)).rejects.toMatchObject({
      code: 'response_withdrawal_expired',
    })
    expect(repo.responses[0]).toMatchObject({ status: 'submitted', rating: 4 })
    expect(events.capturedByTag('guest.rating.retracted')).toHaveLength(0)
  })

  it('uses the snapshotted inclusive threshold and never returns feedback text', async () => {
    const eligible = harness()
    const low = await eligible.lifecycle.submit(
      scope,
      sessionId,
      { rating: 3, responseConsent: true },
      3,
    )
    expect(low.privateFeedbackEligible).toBe(true)
    const receipt = await eligible.lifecycle.addPrivateFeedback(scope, sessionId, {
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

    const ineligible = harness()
    const high = await ineligible.lifecycle.submit(
      scope,
      sessionId,
      { rating: 4, responseConsent: true },
      3,
    )
    expect(high.privateFeedbackEligible).toBe(false)
    await expect(
      ineligible.lifecycle.addPrivateFeedback(scope, sessionId, {
        text: 'Not eligible',
        textConsent: true,
      }),
    ).rejects.toMatchObject({ code: 'feedback_not_eligible' })
  })

  it.each([1, 2, 3, 4, 5])(
    'treats %i as inclusive for its captured threshold',
    async (threshold) => {
      const { lifecycle } = harness()
      const receipt = await lifecycle.submit(
        scope,
        sessionId,
        { rating: threshold, responseConsent: true },
        threshold,
      )
      expect(receipt.privateFeedbackEligible).toBe(true)
    },
  )

  it('unlocks feedback after a high-to-low correction without spending another correction', async () => {
    const { lifecycle, repo } = harness()
    await lifecycle.submit(scope, sessionId, { rating: 5, responseConsent: true }, 3)
    const corrected = await lifecycle.correct(scope, sessionId, { rating: 2 })
    expect(corrected.privateFeedbackEligible).toBe(true)

    await lifecycle.addPrivateFeedback(scope, sessionId, {
      text: 'Now eligible after correction.',
      textConsent: true,
    })
    expect(repo.responses[0]).toMatchObject({
      correctionCount: 1,
      rating: 2,
      text: 'Now eligible after correction.',
    })
  })
})
