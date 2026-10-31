import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { HTTP_STATUS } from '#/shared/http/status'
import { propertyId } from '#/shared/domain/ids'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { REVIEW_TOPICS_V3 } from '#/shared/review-topic-taxonomy'
import { REVIEW_URGENT_REASONS_V3 } from '#/shared/review-analysis-v3'
import type { GuestVoiceDetailRead } from '../application/read-models/guest-voice-v2-check-in'
import { withDetailLiveEvidence } from '../application/read-models/guest-voice-v2-details'
import { resolveDraftReviews } from '../application/read-models/guest-voice-v2-resolve'
import { isAiError } from '../domain/errors'
import { guestVoiceEvidenceReaders } from './guest-voice-evidence.server'

import { GUEST_VOICE_RANGES } from '../application/read-models/guest-voice-v2-population'

const detailDto = z.strictObject({
  propertyId: z.uuid(),
  range: z.enum(GUEST_VOICE_RANGES),
  startLocalDate: z.iso.date(),
  endLocalDate: z.iso.date(),
  target: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('issue'),
      issueId: z.uuid(),
      sense: z.enum(['complaint', 'praise']),
    }),
    z.strictObject({
      kind: z.literal('concern'),
      issueId: z.uuid().nullable(),
      reason: z.enum(REVIEW_URGENT_REASONS_V3),
    }),
    z.strictObject({ kind: z.literal('topic'), topic: z.enum(REVIEW_TOPICS_V3) }),
  ]),
})

export const getGuestVoiceDetailFn = createServerFn({ method: 'GET' })
  .validator(detailDto)
  .handler(
    tracedHandler(
      async ({ data }): Promise<GuestVoiceDetailRead> => {
        const context = await resolveTenantContext(await headersFromContext())
        const id = propertyId(data.propertyId)
        await requireExecutionAllowed({
          actor: context,
          action: 'dashboard.read',
          propertyId: id,
        })
        try {
          const response = await getContainer().aiPublicApi.readGuestVoiceDetail({
            ...data,
            organizationId: context.organizationId,
            propertyId: id,
            actor: context,
          })
          if (response.status !== 'drafted') return response
          const resolved = await resolveDraftReviews(
            response.draft,
            guestVoiceEvidenceReaders(context, id),
          )
          return withDetailLiveEvidence(response.draft, resolved)
        } catch (error) {
          if (isAiError(error) && error.code === 'forbidden')
            throwContextError('AiError', error, HTTP_STATUS.FORBIDDEN)
          throw catchUntagged(error)
        }
      },
      'GET',
      'ai.getGuestVoiceDetail',
    ),
  )
