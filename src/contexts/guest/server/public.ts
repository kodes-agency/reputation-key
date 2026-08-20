import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { z } from 'zod/v4'
import { getContainer } from '#/composition'
import { getEnv } from '#/shared/config/env'
import { headersFromContext } from '#/shared/auth/headers'
import {
  decidePublicExecution,
  requireExecutionAllowed,
} from '#/shared/auth/execution-policy'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError } from '#/shared/auth/server-errors'
import { clientIpFromHeaders } from '#/shared/security/client-ip'
import type { Capability } from '#/shared/auth/beta-capabilities'
import type {
  PublicConsent,
  PublicConsentAssertions,
} from '#/shared/auth/execution-policy'
import type { GuestResponseScope } from '../application/ports/guest-response.repository'
import {
  CORRECTION_WINDOW_MS,
  GuestResponseLifecycleError,
  type GuestResponseInput,
  type GuestResponseView,
} from '../application/use-cases/guest-response-lifecycle'
import type { PublicPortalData } from '../application/dto/public-portal.dto'
import { MAX_TEXT_LENGTH } from '../domain/guest-response'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { guestRateLimitKey } from './guest-session'
import { hashIp } from './hash-ip.server'
export type { PublicPortalLoaderData } from '../application/dto/public-portal.dto'

const baseMutationSchema = z.object({
  token: z.string().min(1).max(256),
  csrfNonce: z.string().uuid(),
})

const responseMutationSchema = baseMutationSchema.extend({
  rating: z.number().int().min(1).max(5).nullable().optional(),
  category: z.string().uuid().nullable().optional(),
  text: z.string().max(MAX_TEXT_LENGTH).nullable().optional(),
  responseConsent: z.boolean().optional(),
  textConsent: z.boolean().optional(),
  mediaConsent: z.boolean().optional(),
  // Bot trap: a real guest never fills this (the form renders it off-screen and
  // aria-hidden), so any value means an automated submit. The rate limiter was
  // the only bot defence on this path.
  honeypot: z.string().max(256).optional(),
})

const issueMediaSchema = baseMutationSchema.extend({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(10 * 1024 * 1024),
})

const confirmMediaSchema = baseMutationSchema.extend({
  mediaId: z.string().uuid(),
  objectKey: z.string().min(1).max(700),
})

const denyWithoutEnumeration = (): never =>
  throwContextError(
    'GuestResponseError',
    { code: 'unavailable', message: 'Request unavailable' },
    404,
  )

async function resolveBoundSession(
  input: Readonly<{
    token: string
    csrfNonce: string
    capability: Capability
    action: string
    assertions: PublicConsentAssertions
    requiredConsents: ReadonlyArray<PublicConsent>
  }>,
) {
  const { useCases } = getContainer()
  let portal: PublicPortalData
  try {
    portal = await useCases.getPublicPortal({ token: input.token })
  } catch {
    return denyWithoutEnumeration()
  }
  const scope: GuestResponseScope = {
    organizationId: portal.organizationId,
    propertyId: portal.propertyId,
    portalId: portal.portal.id,
  }
  const requestHeaders = (await headersFromContext()) ?? new Headers()
  const origin = requestHeaders.get('origin')
  if (origin !== new URL(getEnv().BETTER_AUTH_URL).origin) {
    return denyWithoutEnumeration()
  }
  const session = useCases.guestSessions.verify(requestHeaders.get('cookie') ?? '', scope)
  if (!session || !useCases.guestSessions.verifyCsrf(session, input.csrfNonce)) {
    return denyWithoutEnumeration()
  }
  const decision = await decidePublicExecution({
    action: input.action,
    capability: input.capability,
    ...scope,
    consentAssertions: input.assertions,
    requiredPublicConsents: input.requiredConsents,
    now: new Date(),
  })
  if (!decision.allowed) return denyWithoutEnumeration()
  return { useCases, scope, session, headers: requestHeaders }
}

function lifecycleFailure(error: unknown): never {
  if (!(error instanceof GuestResponseLifecycleError)) throw error
  const conflict: Record<string, true> = {
    already_submitted: true,
    correction_window_expired: true,
    already_deleted: true,
  }
  const hidden: Record<string, true> = {
    response_not_found: true,
    response_unavailable: true,
    media_not_found: true,
  }
  if (hidden[error.code]) return denyWithoutEnumeration()
  throwContextError(
    'GuestResponseError',
    { code: error.code, message: 'Request could not be completed' },
    conflict[error.code] ? 409 : 400,
  )
}

async function rateLimit(
  action: 'submit' | 'correct' | 'media',
  sessionId: string,
  portalId: string,
  headers: Headers,
): Promise<void> {
  const { rateLimiter } = getContainer()
  const limits =
    action === 'submit'
      ? {
          session: { maxRequests: 2, windowSeconds: 60 * 60 },
          networkPortal: { maxRequests: 5, windowSeconds: 60 * 60 },
        }
      : action === 'correct'
        ? {
            session: { maxRequests: 1, windowSeconds: 60 * 60 },
            networkPortal: { maxRequests: 5, windowSeconds: 60 * 60 },
          }
        : {
            session: { maxRequests: 3, windowSeconds: 60 * 60 },
            networkPortal: { maxRequests: 20, windowSeconds: 60 * 60 },
          }
  const keyKind = action === 'media' ? 'media' : 'response'
  const ipHash = hashIp(clientIpFromHeaders(headers))
  let result = await rateLimiter.check(
    `${guestRateLimitKey(keyKind, sessionId, ipHash)}:${action}`,
    limits.session,
  )
  if (result.allowed) {
    result = await rateLimiter.check(
      `${keyKind}:network:${ipHash}:portal:${portalId}`,
      limits.networkPortal,
    )
  }
  if (result.allowed) return
  setResponseHeader(
    'Retry-After',
    String(Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000))),
  )
  throwContextError(
    'GuestResponseError',
    { code: 'rate_limited', message: 'Too many requests' },
    429,
  )
}

function assertions(input: GuestResponseInput): PublicConsentAssertions {
  return {
    analytics: false,
    response: input.responseConsent === true,
    freeText: input.textConsent === true,
    contact: false,
    media: input.mediaConsent === true,
  }
}

/**
 * Honeypot response: a filled trap field is answered with the view a real
 * submit would have produced, and nothing is written. Silent by design — a
 * visible error (or a distinguishable success shape) tells the bot the trap
 * exists, which is the whole value of the trap.
 */
function decoyView(
  input: Readonly<{ rating?: number | null; text?: string | null }>,
): GuestResponseView {
  const now = new Date()
  return {
    id: crypto.randomUUID(),
    status: 'submitted',
    responseConsent: true,
    textConsent: true,
    rating: input.rating ?? null,
    category: null,
    text: input.text?.trim() || null,
    mediaConsent: false,
    submittedAt: now.toISOString(),
    correctedAt: null,
    correctionDeadline: new Date(now.getTime() + CORRECTION_WINDOW_MS).toISOString(),
    deletedAt: null,
  }
}

export const submitGuestResponseFn = createServerFn({ method: 'POST' })
  .inputValidator(responseMutationSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        if (data.honeypot) return decoyView(data)
        const bound = await resolveBoundSession({
          ...data,
          action: 'public:portal.response.submit',
          capability: 'portal.guest_response',
          assertions: assertions(data),
          requiredConsents: ['response'],
        })
        if (data.text?.trim()) {
          await resolveBoundSession({
            ...data,
            action: 'public:portal.response.text.submit',
            capability: 'portal.guest_text',
            assertions: assertions(data),
            requiredConsents: ['response', 'freeText'],
          })
        }
        await rateLimit(
          'submit',
          bound.session.sessionId,
          bound.scope.portalId,
          bound.headers,
        )
        try {
          return await bound.useCases.responseLifecycle.submit(
            bound.scope,
            bound.session.sessionId,
            data,
          )
        } catch (error) {
          return lifecycleFailure(error)
        }
      },
      'POST',
      'guest.response.submit',
    ),
  )

export const correctGuestResponseFn = createServerFn({ method: 'POST' })
  .inputValidator(responseMutationSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        // Same trap on the correction path — the form posts the field to both.
        if (data.honeypot) return decoyView(data)
        const bound = await resolveBoundSession({
          ...data,
          action: 'public:portal.response.correct',
          capability: 'portal.guest_response',
          assertions: assertions(data),
          requiredConsents: ['response'],
        })
        if (data.text?.trim()) {
          await resolveBoundSession({
            ...data,
            action: 'public:portal.response.text.correct',
            capability: 'portal.guest_text',
            assertions: assertions(data),
            requiredConsents: ['response', 'freeText'],
          })
        }
        await rateLimit(
          'correct',
          bound.session.sessionId,
          bound.scope.portalId,
          bound.headers,
        )
        try {
          return await bound.useCases.responseLifecycle.correct(
            bound.scope,
            bound.session.sessionId,
            data,
          )
        } catch (error) {
          return lifecycleFailure(error)
        }
      },
      'POST',
      'guest.response.correct',
    ),
  )

export const withdrawGuestResponseFn = createServerFn({ method: 'POST' })
  .inputValidator(baseMutationSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const bound = await resolveBoundSession({
          ...data,
          action: 'public:portal.response.withdraw',
          capability: 'portal.guest_response',
          assertions: {
            analytics: false,
            response: true,
            freeText: false,
            contact: false,
            media: false,
          },
          requiredConsents: ['response'],
        })
        try {
          return await bound.useCases.responseLifecycle.withdraw(
            bound.scope,
            bound.session.sessionId,
          )
        } catch (error) {
          return lifecycleFailure(error)
        }
      },
      'POST',
      'guest.response.withdraw',
    ),
  )

export const issueGuestMediaFn = createServerFn({ method: 'POST' })
  .inputValidator(issueMediaSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const bound = await resolveBoundSession({
          ...data,
          action: 'public:portal.media.issue',
          capability: 'portal.guest_media',
          assertions: {
            analytics: false,
            response: true,
            freeText: false,
            contact: false,
            media: true,
          },
          requiredConsents: ['response', 'media'],
        })
        await rateLimit(
          'media',
          bound.session.sessionId,
          bound.scope.portalId,
          bound.headers,
        )
        try {
          return await bound.useCases.responseLifecycle.issueMedia(
            bound.scope,
            bound.session.sessionId,
            data,
          )
        } catch (error) {
          return lifecycleFailure(error)
        }
      },
      'POST',
      'guest.media.issue',
    ),
  )

export const confirmGuestMediaFn = createServerFn({ method: 'POST' })
  .inputValidator(confirmMediaSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const bound = await resolveBoundSession({
          ...data,
          action: 'public:portal.media.confirm',
          capability: 'portal.guest_media',
          assertions: {
            analytics: false,
            response: true,
            freeText: false,
            contact: false,
            media: true,
          },
          requiredConsents: ['response', 'media'],
        })
        try {
          return await bound.useCases.responseLifecycle.confirmMedia(
            bound.scope,
            bound.session.sessionId,
            data,
          )
        } catch (error) {
          return lifecycleFailure(error)
        }
      },
      'POST',
      'guest.media.confirm',
    ),
  )

const moderationSchema = z.object({
  propertyId: z.string().uuid(),
  portalId: z.string().uuid(),
  responseId: z.string().uuid(),
  action: z.enum(['quarantine', 'delete']),
})

// Staff moderation, not guest collection: gating this on portal.guest_response
// made the two impossible to enable independently — a tenant that stopped
// collecting guest responses also lost the ability to moderate the ones it had
// already collected. portal.guest_response stays on the public-facing paths.
export const moderateGuestResponseFn = createServerFn({ method: 'POST' })
  .inputValidator(moderationSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const actor = await resolveTenantContext(headers)
        await requireExecutionAllowed({
          actor,
          action: 'feedback.respond',
          capability: 'portal.write',
          propertyId: data.propertyId,
        })
        const { useCases } = getContainer()
        try {
          return await useCases.responseLifecycle.moderate(
            {
              organizationId: actor.organizationId,
              propertyId: data.propertyId,
              portalId: data.portalId,
            },
            data.responseId,
            data.action,
          )
        } catch (error) {
          return lifecycleFailure(error)
        }
      },
      'POST',
      'guest.response.moderate',
    ),
  )
