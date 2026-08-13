import type { StoragePort } from '#/contexts/portal/application/public-api'
import type {
  GuestResponseRepository,
  GuestResponseScope,
} from '../ports/guest-response.repository'
import {
  claimMediaForProcessing,
  completeMediaProcessing,
  issueGuestMedia,
  MAX_GUEST_MEDIA_BYTES,
} from '../../domain/guest-media'
import {
  correctResponse,
  createResponse,
  deleteResponse,
  moderateResponse,
  submitResponse,
  type GuestResponse,
  type ResponseError,
} from '../../domain/guest-response'

export type GuestResponseInput = Readonly<{
  rating?: number | null
  category?: string | null
  text?: string | null
  responseConsent?: boolean
  textConsent?: boolean
  mediaConsent?: boolean
}>

export type GuestResponseView = Readonly<{
  id: string
  status: GuestResponse['status']
  responseConsent: boolean
  textConsent: boolean
  rating: number | null
  category: string | null
  text: string | null
  mediaConsent: boolean
  submittedAt: string | null
  correctedAt: string | null
  correctionDeadline: string | null
  deletedAt: string | null
}>

export class GuestResponseLifecycleError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'GuestResponseLifecycleError'
  }
}

const correctionWindowMs = 60 * 60 * 1000
const retentionMs = 90 * 24 * 60 * 60 * 1000

function toView(response: GuestResponse): GuestResponseView {
  return {
    id: response.id,
    status: response.status,
    rating: response.rating,
    category: response.category,
    text: response.text,
    mediaConsent: response.mediaConsent,
    responseConsent: response.responseConsent,
    textConsent: response.textConsent,
    submittedAt: response.submittedAt?.toISOString() ?? null,
    correctedAt: response.correctedAt?.toISOString() ?? null,
    correctionDeadline: response.submittedAt
      ? new Date(response.submittedAt.getTime() + correctionWindowMs).toISOString()
      : null,
    deletedAt: response.deletedAt?.toISOString() ?? null,
  }
}

function unwrap(result: GuestResponse | ResponseError): GuestResponse {
  if ('code' in result) throw new GuestResponseLifecycleError(result.code)
  return result
}

export function guestResponseLifecycle(
  deps: Readonly<{
    repo: GuestResponseRepository
    storage: StoragePort
    clock: () => Date
    idGen: () => string
  }>,
) {
  const getState = async (scope: GuestResponseScope, sessionId: string) => {
    const response = await deps.repo.findForSession(scope, sessionId)
    return response ? toView(response) : null
  }

  const removeObjects = async (
    scope: GuestResponseScope,
    objectKeys: ReadonlyArray<string>,
  ) => {
    for (const objectKey of objectKeys) {
      try {
        await deps.storage.deleteObject(objectKey)
        await deps.repo.markMediaDeleted(scope, objectKey, deps.clock())
      } catch {
        // The durable purge_pending row is intentionally retained for retry.
      }
    }
  }

  return {
    getState,

    submit: async (
      scope: GuestResponseScope,
      sessionId: string,
      input: GuestResponseInput,
    ): Promise<GuestResponseView> => {
      const existing = await deps.repo.findForSession(scope, sessionId)
      if (existing) return toView(existing)
      const now = deps.clock()
      const submitted = unwrap(
        submitResponse(
          createResponse({
            id: deps.idGen(),
            ...scope,
            sessionId,
            retentionDeadline: new Date(now.getTime() + retentionMs),
          }),
          input,
          now,
        ),
      )
      if (await deps.repo.insertSubmitted(submitted)) return toView(submitted)
      const raced = await deps.repo.findForSession(scope, sessionId)
      if (!raced) throw new GuestResponseLifecycleError('response_unavailable')
      return toView(raced)
    },

    correct: async (
      scope: GuestResponseScope,
      sessionId: string,
      input: GuestResponseInput,
    ): Promise<GuestResponseView> => {
      const current = await deps.repo.findForSession(scope, sessionId)
      if (!current) throw new GuestResponseLifecycleError('response_not_found')
      const corrected = unwrap(
        correctResponse(current, input, deps.clock(), correctionWindowMs),
      )
      if (!(await deps.repo.saveCorrection(corrected))) {
        throw new GuestResponseLifecycleError('already_submitted')
      }
      return toView(corrected)
    },

    withdraw: async (
      scope: GuestResponseScope,
      sessionId: string,
    ): Promise<GuestResponseView> => {
      const current = await deps.repo.findForSession(scope, sessionId)
      if (!current) throw new GuestResponseLifecycleError('response_not_found')
      if (current.status === 'deleted') return toView(current)
      const deleted = unwrap(deleteResponse(current, deps.clock()))
      const objectKeys = await deps.repo.deleteAndQueueMediaPurge(deleted)
      await removeObjects(scope, objectKeys)
      return toView(deleted)
    },

    moderate: async (
      scope: GuestResponseScope,
      responseId: string,
      action: 'quarantine' | 'delete',
    ): Promise<GuestResponseView> => {
      const current = await deps.repo.findById(scope, responseId)
      if (!current) throw new GuestResponseLifecycleError('response_not_found')
      if (action === 'delete') {
        if (current.status === 'deleted') return toView(current)
        const deleted = unwrap(deleteResponse(current, deps.clock()))
        const objectKeys = await deps.repo.deleteAndQueueMediaPurge(deleted)
        await removeObjects(scope, objectKeys)
        return toView(deleted)
      }
      const moderated = unwrap(moderateResponse(current, deps.clock()))
      if (!(await deps.repo.saveModeration(moderated))) {
        throw new GuestResponseLifecycleError('response_not_found')
      }
      return toView(moderated)
    },

    issueMedia: async (
      scope: GuestResponseScope,
      sessionId: string,
      input: Readonly<{ contentType: string; sizeBytes: number }>,
    ) => {
      const response = await deps.repo.findForSession(scope, sessionId)
      if (!response) throw new GuestResponseLifecycleError('response_not_found')
      const media = issueGuestMedia(
        response,
        { id: deps.idGen(), ...input },
        deps.clock(),
      )
      if ('code' in media) throw new GuestResponseLifecycleError(media.code)
      if (!(await deps.repo.insertMedia(media))) {
        throw new GuestResponseLifecycleError('media_unavailable')
      }
      const { uploadUrl } = await deps.storage.createPresignedUploadUrl(
        media.objectKey,
        media.contentType,
        MAX_GUEST_MEDIA_BYTES,
      )
      return {
        mediaId: media.id,
        objectKey: media.objectKey,
        uploadUrl,
        contentType: media.contentType,
        maxSizeBytes: MAX_GUEST_MEDIA_BYTES,
        expiresAt: media.expiresAt.toISOString(),
      }
    },

    confirmMedia: async (
      scope: GuestResponseScope,
      sessionId: string,
      input: Readonly<{ mediaId: string; objectKey: string }>,
    ) => {
      const media = await deps.repo.findMediaForSession(scope, sessionId, input.mediaId)
      if (!media || media.objectKey !== input.objectKey) {
        throw new GuestResponseLifecycleError('media_not_found')
      }
      const response = await deps.repo.findForSession(scope, sessionId)
      if (!response) throw new GuestResponseLifecycleError('response_not_found')
      const lease = deps.idGen()
      const claimed = claimMediaForProcessing(media, response, lease, deps.clock())
      if (
        'code' in claimed ||
        !(await deps.repo.claimMedia(media, lease, deps.clock()))
      ) {
        throw new GuestResponseLifecycleError(
          'code' in claimed ? claimed.code : 'media_not_processable',
        )
      }
      let publicUrl: string
      try {
        if (!deps.storage.inspectObject) {
          throw new Error('Object metadata inspection is unavailable')
        }
        const metadata = await deps.storage.inspectObject(media.objectKey)
        if (
          metadata.contentType !== media.contentType ||
          metadata.sizeBytes !== media.declaredSizeBytes
        ) {
          throw new Error('Object metadata did not match its issuance')
        }
        publicUrl = await deps.storage.confirmUpload(media.objectKey)
      } catch {
        await deps.repo.queueMediaPurge(media, deps.clock())
        try {
          await deps.storage.deleteObject(media.objectKey)
          await deps.repo.markMediaDeleted(scope, media.objectKey, deps.clock())
        } catch {
          // Keep purge_pending for retry.
        }
        throw new GuestResponseLifecycleError('media_validation_failed')
      }

      const completed = completeMediaProcessing(
        claimed,
        response,
        lease,
        publicUrl,
        deps.clock(),
      )
      if (
        completed.deleteObject ||
        !(await deps.repo.completeMedia(completed.media, lease, publicUrl, deps.clock()))
      ) {
        await deps.repo.queueMediaPurge(media, deps.clock())
        try {
          await deps.storage.deleteObject(media.objectKey)
          await deps.repo.markMediaDeleted(scope, media.objectKey, deps.clock())
        } catch {
          // Withdrawal already won; purge_pending remains durable.
        }
        throw new GuestResponseLifecycleError('media_not_processable')
      }
      return { mediaId: media.id, status: 'ready' as const }
    },
  } as const
}
