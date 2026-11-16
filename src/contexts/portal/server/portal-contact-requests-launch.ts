// Portal context — whether contact requests are launched (server function).
// Read-only. The Portal settings screen shows its contact-request switch only
// while this says they are.

import { createServerFn } from '@tanstack/react-start'
import { getContainer } from '#/composition'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { commandHandler } from '#/shared/commands/command.server'
import {
  CONTACT_REQUEST_NOTICES_IN_FORCE,
  type ContactRequestNotice,
} from '#/shared/domain/contact-request-notice'
import type { ContactRequestsLaunch } from '../editor/contracts'
import { portalCommandErrors } from './portal-command-errors'

/** Launched means the deployment switch is on and the safety block is lifted. */
export function readContactRequestsLaunch(
  facts: Readonly<{
    switchedOn: boolean
    safetyBlocked: boolean
    noticesInForce?: readonly ContactRequestNotice[]
  }>,
): ContactRequestsLaunch {
  return {
    launched: facts.switchedOn && !facts.safetyBlocked,
    noticeInForce: (facts.noticesInForce ?? CONTACT_REQUEST_NOTICES_IN_FORCE).length > 0,
  }
}

export const getContactRequestsLaunch = createServerFn({ method: 'GET' }).handler(
  commandHandler(
    {
      method: 'GET',
      name: 'portal.getContactRequestsLaunch',
      errors: portalCommandErrors,
    },
    async ({ headers }) => {
      const ctx = await resolveTenantContext(headers)
      await requireExecutionAllowed({
        actor: ctx,
        action: 'portal.read',
        capability: 'portal.read',
      })
      const { isBlockedCapability } = await import('#/shared/auth/beta-capabilities')
      return readContactRequestsLaunch({
        switchedOn: getContainer().guestContactRequests?.isEnabled() === true,
        safetyBlocked: isBlockedCapability('portal.guest_contact'),
      })
    },
  ),
)
