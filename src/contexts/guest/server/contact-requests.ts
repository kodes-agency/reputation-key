// fallow-ignore-file unused-file
// Mounted only when contact requests launch; until then nothing imports this.
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError } from '#/shared/auth/server-errors'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { guestResponseMutationDto } from '../application/dto/guest-response-form.dto'
import { isContactRequestError } from '../domain/errors'
import {
  contactRequestEmailSchema,
  contactRequestNameSchema,
  type ContactRequestGuestAuthority,
} from '../contact-requests/contracts'
import {
  applyGuestPublicResponsePrivacy,
  guestPublicResponseValidator,
} from './public-response-privacy.server'
import {
  denyWithoutEnumeration,
  rateLimit,
  resolveBoundSession,
} from './guest-public-binding.server'

const submitContactRequestDto = guestResponseMutationDto.extend({
  email: contactRequestEmailSchema,
  name: contactRequestNameSchema.optional(),
  consent: z.boolean(),
  honeypot: z.string().max(256).optional(),
})

const managerRequestDto = z.object({
  propertyId: z.uuid(),
  portalId: z.uuid(),
  responseId: z.uuid(),
})

const revealContactRequestDto = z.object({
  propertyId: z.uuid(),
  portalId: z.uuid(),
  contactRequestId: z.uuid(),
})

const guestAssertions = (contact: boolean) =>
  ({
    analytics: false,
    response: true,
    freeText: false,
    contact,
    media: false,
  }) as const

// Contact requests answer a guest or a manager only with what they may see.
// A switched-off feature, a foreign response and a missing row look the same.
const GUEST_REFUSED = new Set([
  'contact_disabled',
  'not_authorized',
  'not_found',
  'source_unavailable',
  'unavailable',
])

function contactRequestFailure(error: unknown): never {
  if (!isContactRequestError(error)) throw error
  if (GUEST_REFUSED.has(error.code)) return denyWithoutEnumeration()
  throwContextError(
    'ContactRequestError',
    { code: error.code, message: 'Request could not be completed' },
    error.code === 'duplicate' ? 409 : 400,
  )
}

function commandsOrRefuse() {
  const commands = getContainer().guestContactRequests
  return commands ?? denyWithoutEnumeration()
}

// Managers get the same 404 for a switched-off feature as for a missing request,
// before any permission or capability answer can tell them which it was.
function managerCommandsOrRefuse() {
  const commands = commandsOrRefuse()
  return commands.isEnabled() ? commands : denyWithoutEnumeration()
}

async function guestAuthority(
  csrfNonce: string,
  headers: Headers,
): Promise<ContactRequestGuestAuthority> {
  return { signedSession: headers.get('cookie') ?? '', csrfNonce }
}

export const submitContactRequestFn = createServerFn({ method: 'POST' })
  .validator(guestPublicResponseValidator(submitContactRequestDto))
  .handler(
    tracedHandler(
      async ({ data }) => {
        applyGuestPublicResponsePrivacy()
        const commands = commandsOrRefuse()
        if (data.honeypot) return { status: 'submitted' as const }
        const bound = await resolveBoundSession({
          ...data,
          action: 'public:portal.response.contact.submit',
          capability: 'portal.guest_contact',
          assertions: guestAssertions(data.consent === true),
          requiredConsents: ['response', 'contact'],
        })
        await rateLimit(
          'contact_request',
          bound.session.sessionId,
          bound.scope,
          bound.headers,
        )
        try {
          return await commands.submit({
            ...bound.scope,
            email: data.email,
            ...(data.name === undefined ? {} : { name: data.name }),
            consent: data.consent,
            purpose: 'manager_follow_up',
            authority: await guestAuthority(data.csrfNonce, bound.headers),
          })
        } catch (error) {
          return contactRequestFailure(error)
        }
      },
      'POST',
      'guest.contact_request.submit',
    ),
  )

export const withdrawContactRequestFn = createServerFn({ method: 'POST' })
  .validator(guestPublicResponseValidator(guestResponseMutationDto))
  .handler(
    tracedHandler(
      async ({ data }) => {
        applyGuestPublicResponsePrivacy()
        const commands = commandsOrRefuse()
        const bound = await resolveBoundSession({
          ...data,
          action: 'public:portal.response.contact.withdraw',
          capability: 'portal.guest_response',
          assertions: guestAssertions(false),
          requiredConsents: ['response'],
        })
        await rateLimit(
          'contact_request_withdraw',
          bound.session.sessionId,
          bound.scope,
          bound.headers,
        )
        try {
          return await commands.withdraw({
            ...bound.scope,
            authority: await guestAuthority(data.csrfNonce, bound.headers),
          })
        } catch (error) {
          return contactRequestFailure(error)
        }
      },
      'POST',
      'guest.contact_request.withdraw',
    ),
  )

export const getContactRequestFn = createServerFn({ method: 'GET' })
  .validator(managerRequestDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const commands = managerCommandsOrRefuse()
        const ctx = await resolveTenantContext(await headersFromContext())
        await requireExecutionAllowed({ actor: ctx, action: 'inbox.read' })
        try {
          const request = await commands.getMasked(
            { organizationId: ctx.organizationId, ...data },
            ctx,
          )
          return request ?? denyWithoutEnumeration()
        } catch (error) {
          return contactRequestFailure(error)
        }
      },
      'GET',
      'guest.contact_request.get',
    ),
  )

export const revealContactRequestFn = createServerFn({ method: 'POST' })
  .validator(revealContactRequestDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const commands = managerCommandsOrRefuse()
        const ctx = await resolveTenantContext(await headersFromContext())
        await requireExecutionAllowed({ actor: ctx, action: 'feedback.contact_read' })
        try {
          return await commands.reveal(
            {
              organizationId: ctx.organizationId,
              ...data,
              accessPurpose: 'respond_to_contact_request',
            },
            ctx,
          )
        } catch (error) {
          return contactRequestFailure(error)
        }
      },
      'POST',
      'guest.contact_request.reveal',
    ),
  )
