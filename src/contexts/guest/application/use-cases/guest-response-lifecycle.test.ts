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
        comment: row.textConsent ? row.text : null,
        ratingValue: row.responseConsent ? row.rating : null,
      }
    },
    insertSubmitted: async (response) => {
      if (
        responses.some(
          (row) =>
            row.organizationId === response.organizationId &&
            row.portalId === response.portalId &&
            row.sessionId === response.sessionId,
        )
      ) {
        return false
      }
      responses.push(response)
      return true
    },
    saveCorrection: async (response) => {
      const index = responses.findIndex(
        (row) => row.id === response.id && row.status === 'submitted',
      )
      if (index < 0) return false
      responses[index] = response
      return true
    },
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
    deleteAndQueueMediaPurge: async (response) => {
      const index = responses.findIndex((row) => row.id === response.id)
      if (index < 0) return []
      responses[index] = response
      return media
        .filter((item) => item.responseId === response.id && item.status !== 'deleted')
        .map((item) => {
          const indexInStore = media.indexOf(item)
          media[indexInStore] = {
            ...item,
            status: 'purge_pending',
            processingLease: null,
            publicUrl: null,
            deletedAt: response.deletedAt,
          }
          return item.objectKey
        })
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

function harness() {
  const repo = memoryRepo()
  let sequence = 10
  let confirm: (() => Promise<string>) | undefined
  let inspect:
    | (() => Promise<{ contentType: string | null; sizeBytes: number | null }>)
    | undefined
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
  const lifecycle = guestResponseLifecycle({
    repo,
    storage,
    clock: () => new Date('2026-08-09T12:00:00Z'),
    idGen: () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`,
    events,
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
    const corrected = await lifecycle.correct(
      scope,
      '00000000-0000-4000-8000-000000000003',
      { rating: 4 },
    )
    expect(corrected.status).toBe('corrected')
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
    expect(withdrawn).toMatchObject({ status: 'deleted', rating: null, text: null })
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
    const response = await lifecycle.submit(scope, sessionId, {
      rating: 5,
      responseConsent: true,
      mediaConsent: true,
    })
    await lifecycle.issueMedia(scope, sessionId, {
      contentType: 'image/webp',
      sizeBytes: 1024,
    })
    const moderated = await lifecycle.moderate(scope, response.id, 'quarantine')
    expect(moderated.status).toBe('moderated')
    expect(repo.media[0]).toMatchObject({
      status: 'quarantined',
      publicUrl: null,
    })
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

  it('emits a rating fact and a feedback fact for a consented rating plus free text', async () => {
    const { lifecycle, events } = harness()

    const submitted = await lifecycle.submit(scope, sessionId, {
      rating: 4,
      text: 'Great stay, very responsive team.',
      responseConsent: true,
      textConsent: true,
    })

    expect(events.capturedByTag('guest.rating.submitted')).toMatchObject([
      {
        ratingId: submitted.id,
        organizationId: scope.organizationId,
        portalId: scope.portalId,
        propertyId: scope.propertyId,
        value: 4,
      },
    ])
    expect(events.capturedByTag('guest.feedback.submitted')).toMatchObject([
      { feedbackId: submitted.id, ratingId: submitted.id },
    ])
  })

  it('emits no feedback fact when the guest supplied no free text', async () => {
    const { lifecycle, events } = harness()

    await lifecycle.submit(scope, sessionId, { rating: 5, responseConsent: true })

    expect(events.capturedByTag('guest.rating.submitted')).toHaveLength(1)
    expect(events.capturedByTag('guest.feedback.submitted')).toHaveLength(0)
  })

  it('emits only a feedback fact when the guest supplied text and no rating', async () => {
    const { lifecycle, events } = harness()

    await lifecycle.submit(scope, sessionId, {
      text: 'The lobby coffee is excellent.',
      textConsent: true,
    })

    expect(events.capturedByTag('guest.rating.submitted')).toHaveLength(0)
    expect(events.capturedByTag('guest.feedback.submitted')).toMatchObject([
      { ratingId: null },
    ])
  })

  it('emits nothing for a repeated submit of the same session', async () => {
    const { lifecycle, events } = harness()
    const input = { rating: 3, responseConsent: true }

    await lifecycle.submit(scope, sessionId, input)
    await lifecycle.submit(scope, sessionId, input)

    expect(events.capturedByTag('guest.rating.submitted')).toHaveLength(1)
  })

  it('emits nothing for a correction, so one guest never yields two readings', async () => {
    const { lifecycle, events } = harness()
    await lifecycle.submit(scope, sessionId, { rating: 3, responseConsent: true })

    await lifecycle.correct(scope, sessionId, { rating: 1 })

    expect(events.capturedEvents).toHaveLength(1)
    expect(events.capturedByTag('guest.rating.submitted')).toMatchObject([{ value: 3 }])
  })

  it('emits nothing for a withdrawal', async () => {
    const { lifecycle, events } = harness()
    await lifecycle.submit(scope, sessionId, { rating: 3, responseConsent: true })

    await lifecycle.withdraw(scope, sessionId)

    expect(events.capturedEvents).toHaveLength(1)
  })
})
