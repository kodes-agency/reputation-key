import { randomBytes, randomUUID } from 'node:crypto'
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
    portalApi: portal.publicApi.portal,
    identityManagerFacts: identity.publicApi.managerFacts,
    identityAccountAdminAuthority: identity.publicApi.accountAdminAuthority,
    staffApi: identity.publicApi.people,
    logger,
    executionPolicy: identity.policy.executionPolicy,
    contactRequests: {
      enabled: env.CONTACT_REQUESTS_ENABLED,
      generateIv: () => randomBytes(12),
      ...(env.CONTACT_REQUEST_ENCRYPTION_KEY === undefined
        ? {}
        : { encryptionKey: env.CONTACT_REQUEST_ENCRYPTION_KEY }),
    },
    sessionSecret: env.GUEST_SESSION_SALT,
    publicOrigin: new URL(env.BETTER_AUTH_URL).origin,
    secureCookies: env.NODE_ENV === 'production',
    resolvePrimaryStaffAttribution:
      identity.publicApi.people.resolvePrimaryStaffAttribution,
    observationLossRedis: redis,
    withdrawalJournalConfig: {
      RESTORE_MODE: env.RESTORE_MODE,
      AWS_S3_REGION: env.AWS_S3_REGION,
      AWS_S3_ACCESS_KEY: env.AWS_S3_ACCESS_KEY,
      AWS_S3_SECRET_ACCESS_KEY: env.AWS_S3_SECRET_ACCESS_KEY,
      AWS_S3_BUCKET_NAME: env.AWS_S3_BUCKET_NAME,
      S3_INTERNAL_ENDPOINT: env.S3_INTERNAL_ENDPOINT,
      S3_PRESIGN_ENDPOINT: env.S3_PRESIGN_ENDPOINT,
      S3_FORCE_PATH_STYLE: env.S3_FORCE_PATH_STYLE,
    },
  })

  return guest
}
