import { randomUUID } from 'node:crypto'
import { buildGuestContext } from '#/contexts/guest/build'
import type { buildIdentityContext } from '#/contexts/identity/build'
import type { buildPortalContext } from '#/contexts/portal/build'
import type { ContextWiringInput } from './runtime'

export function wireGuest(
  { db, clock, logger, env, redis }: ContextWiringInput,
  identity: ReturnType<typeof buildIdentityContext>,
  portal: ReturnType<typeof buildPortalContext>,
) {
  const guest = buildGuestContext({
    db,
    clock,
    idGen: randomUUID,
    monotonicNow: performance.now.bind(performance),
    portalApi: portal.publicApi.portal,
    identityManagerFacts: identity.publicApi.managerFacts,
    identityAccountAdminAuthority: identity.publicApi.accountAdminAuthority,
    staffApi: identity.publicApi.people,
    logger,
    sessionSecret: env.GUEST_SESSION_SALT,
    publicOrigin: new URL(env.BETTER_AUTH_URL).origin,
    secureCookies: env.NODE_ENV === 'production',
    resolvePrimaryStaffAttribution:
      identity.publicApi.people.resolvePrimaryStaffAttribution,
    observationLossRedis: redis,
  })

  return guest
}
