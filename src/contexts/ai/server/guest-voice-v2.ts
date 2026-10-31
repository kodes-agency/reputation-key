import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { HTTP_STATUS } from '#/shared/http/status'
import { propertyId } from '#/shared/domain/ids'
import { guestVoiceEvidenceReaders } from './guest-voice-evidence.server'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { GUEST_VOICE_RANGES, type GuestVoiceRange } from '#/shared/dashboard-range'
import type { GuestVoiceV2Read } from '../application/read-models/guest-voice-v2'
import { withLiveEvidence } from '../application/read-models/guest-voice-v2-evidence'
import { resolveDraftReviews } from '../application/read-models/guest-voice-v2-resolve'
import type { GuestVoiceV2Range } from '../application/use-cases/read-guest-voice-v2'
import { isAiError } from '../domain/errors'

// The page's own vocabulary (`?range=`). Guest voice 2.0 has no "All time": a bookmark
// that still says it reads the automatic window.
const getGuestVoiceV2Dto = z.strictObject({
  propertyId: z.uuid(),
  range: z.enum(GUEST_VOICE_RANGES),
})

const RANGE_OF_PAGE: Readonly<Record<GuestVoiceRange, GuestVoiceV2Range>> = {
  auto: 'auto',
  '30d': '30d',
  '90d': '90d',
  '180d': '180d',
  '365d': '365d',
  all: 'auto',
}

/**
 * What the page is told: its draw (2.0, or too few reviews for patterns), or why today's
 * page is the one to draw (nothing is analysed under v3, AI is off, or it is not ready).
 */
export type GuestVoiceV2Result =
  Readonly<{ status: 'disabled' | 'preparing' | 'not_v3' }> | GuestVoiceV2Read

/**
 * Guest voice 2.0 is a dashboard read, gated as today's page is (`dashboard.read`). The
 * AI-specific gate and the epoch fences stay inside the use case.
 */
export const getGuestVoiceV2Fn = createServerFn({ method: 'GET' })
  .validator(getGuestVoiceV2Dto)
  .handler(
    tracedHandler(
      async ({ data }): Promise<GuestVoiceV2Result> => {
        const headers = await headersFromContext()
        const context = await resolveTenantContext(headers)
        const id = propertyId(data.propertyId)
        await requireExecutionAllowed({
          actor: context,
          action: 'dashboard.read',
          propertyId: id,
        })
        try {
          const response = await getContainer().aiPublicApi.readGuestVoiceV2({
            organizationId: context.organizationId,
            propertyId: id,
            actor: context,
            range: RANGE_OF_PAGE[data.range],
          })
          if (response.status !== 'drafted') return { status: response.status }
          const resolved = await resolveDraftReviews(
            response.draft,
            guestVoiceEvidenceReaders(context, id),
          )
          return withLiveEvidence(response.draft, resolved)
        } catch (error) {
          // The use case authorizes the reader for the Property itself.
          if (isAiError(error) && error.code === 'forbidden') {
            throwContextError('AiError', error, HTTP_STATUS.FORBIDDEN)
          }
          throw catchUntagged(error)
        }
      },
      'GET',
      'ai.getGuestVoiceV2',
    ),
  )
