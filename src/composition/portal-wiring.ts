import { randomBytes } from 'node:crypto'
import { buildPortalContext } from '#/contexts/portal/build'
import type { buildIdentityContext } from '#/contexts/identity/build'
import type { buildPropertyContext } from '#/contexts/property/build'
import type { buildReportingContext } from '#/contexts/reporting/build'
import type { ContextWiringInput } from './runtime'

export function wirePortal(
  { options, db, outboxRepo, clock, env, logger }: ContextWiringInput,
  identity: ReturnType<typeof buildIdentityContext>,
  property: ReturnType<typeof buildPropertyContext>,
  getReporting: () => ReturnType<typeof buildReportingContext>,
) {
  const portal = buildPortalContext({
    ratingGoalGuard: {
      findRunningRatingGoalBlock: (...args) =>
        getReporting().publicApi.findPortalRatingGoalBlock(...args),
    },
    db,
    outboxRepo,
    clock,
    propertyApi: property.publicApi,
    staffPublicApi: identity.publicApi.people,
    identityManagerFacts: identity.publicApi.managerFacts,
    baseUrl: env.BETTER_AUTH_URL ?? 'http://localhost:3000',
    printCodes: {
      printOrigin: env.PORTAL_PRINT_ORIGIN,
      enabled: env.PORTAL_PRINT_CODES_ENABLED,
    },
    idGen: () => crypto.randomUUID(),
    secureRandomBytes: randomBytes,
    tokenHashSecret: env.PORTAL_TOKEN_HASH_SECRET,
    addressEncryptionKeys: env.PORTAL_ADDRESS_ENCRYPTION_KEYS,
    logger,
    storage: options?.providers?.storage,
    storageConfig: {
      accessKey: env.AWS_S3_ACCESS_KEY ?? '',
      secretKey: env.AWS_S3_SECRET_ACCESS_KEY ?? '',
      bucketName: env.AWS_S3_BUCKET_NAME ?? '',
      region: env.AWS_S3_REGION ?? '',
      internalEndpoint: env.S3_INTERNAL_ENDPOINT,
      presignEndpoint: env.S3_PRESIGN_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    },
    printKitFinalEnabled: env.PRINT_KIT_FINAL_ENABLED,
    portalOwnLookEnabled: env.PORTAL_OWN_LOOK_ENABLED,
  })

  return portal
}
