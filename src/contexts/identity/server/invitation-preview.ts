// The invitation link's preview (anonymous server function).
// The invitation id is a bearer secret already mailed to the invitee; the
// preview returns only what that email states, plus whether the address has an
// account, and one identical shape for every id that is not a usable invitation.

import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { clientIpFromHeaders } from '#/shared/security/client-ip'
import { getContainer } from '#/composition'
import { invitationId } from '#/shared/domain/ids'
import { isIdentityError } from '../domain/errors'
import {
  invitationPreviewInputSchema,
  type InvitationPreviewInput,
} from '../application/dto/invitation.dto'
import type { InvitationPreview } from '../application/use-cases/get-invitation-preview'
import { throwIdentityError } from './organizations.errors.server'

/** Enough for a person opening and reopening a link; too few to probe ids. */
const PREVIEW_LIMIT = Object.freeze({ maxRequests: 30, windowSeconds: 600 })

export const getInvitationPreviewHandler = createServerOnlyFn(
  async ({
    data,
  }: Readonly<{ data: InvitationPreviewInput }>): Promise<InvitationPreview> => {
    const reqHeaders = await headersFromContext()
    const { rateLimiter, identityPublicApi } = getContainer()
    const limit = await rateLimiter.check(
      `identity:invitation-preview:${clientIpFromHeaders(reqHeaders)}`,
      PREVIEW_LIMIT,
    )
    if (!limit.allowed) {
      throwContextError(
        'AuthError',
        { code: 'rate_limited', message: 'Too many requests. Try again later.' },
        429,
      )
    }
    try {
      return await identityPublicApi.requests.getInvitationPreview(
        invitationId(data.invitationId),
      )
    } catch (e) {
      if (isIdentityError(e)) throwIdentityError(e)
      throw catchUntagged(e)
    }
  },
)

export const getInvitationPreview = createServerFn({ method: 'GET' })
  .validator(invitationPreviewInputSchema)
  .handler(
    tracedHandler(getInvitationPreviewHandler, 'GET', 'identity.getInvitationPreview'),
  )
