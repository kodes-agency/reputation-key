import type { Database } from '#/shared/db'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { checkScopedCapability } from '#/shared/auth/beta-capabilities'
import { captureObservabilityException } from '#/shared/observability/telemetry'
import {
  MERCHANT_AI_NOTICE,
  MERCHANT_AI_SOURCE_POLICY_ID,
  MERCHANT_AI_PROVIDER_DEPLOYMENT_PROFILE_VERSION,
  MERCHANT_AI_REDACTION_PROFILE_FAMILY,
} from './application/dto/merchant-ai-notice.dto'
import { createMerchantAiNoticeUpdates } from './application/use-cases/merchant-ai-notice-updates'
import { renewLapsedMerchantAiAuthorizations } from './application/use-cases/renew-lapsed-merchant-ai-authorizations'
import { createMerchantAiNoticeUpdateStore } from './infrastructure/repositories/merchant-ai-notice-updates.repository'
import { createStandingRenewalStore } from './infrastructure/repositories/merchant-ai-standing-renewal.repository'
import { getMemberRole } from './infrastructure/repositories/manager-membership.repository'

type Deps = Readonly<{
  db: Database
  idGen: () => string
  clock: () => Date
  logger: LoggerPort
}>
const PURPOSE = {
  review_analysis: 'ai.analyze',
  reply_drafting: 'ai.generate_reply',
  property_trends: 'ai.detect_trends',
} as const

type Reader = Readonly<{ organizationId: string; actorUserId: string }>
type Capabilities = Readonly<{
  authorization: { capabilities: readonly (keyof typeof PURPOSE)[] } | null
}>

function pauseReason(record: Capabilities, organizationId: string, propertyId: string) {
  for (const capability of record.authorization?.capabilities ?? []) {
    const decision = checkScopedCapability(
      { organizationId, propertyId },
      PURPOSE[capability],
    )
    if (!decision.allowed)
      return decision.reason === 'org_suspended' ? 'org_suspended' : 'policy_denied'
  }
  return null
}

function renewalStore(deps: Deps) {
  return createStandingRenewalStore({
    db: deps.db,
    idGen: deps.idGen,
    policy: {
      noticeVersion: MERCHANT_AI_NOTICE.version,
      noticeDigest: MERCHANT_AI_NOTICE.digest,
      sourcePolicyId: MERCHANT_AI_SOURCE_POLICY_ID,
      routingPolicyVersion: 1,
      providerDeploymentProfileVersion: MERCHANT_AI_PROVIDER_DEPLOYMENT_PROFILE_VERSION,
      redactionProfileFamily: MERCHANT_AI_REDACTION_PROFILE_FAMILY,
    },
    authorize: async (input) => {
      const decision = checkScopedCapability(input, PURPOSE[input.capability])
      return decision.allowed
        ? 'allowed'
        : decision.reason === 'org_suspended'
          ? 'org_suspended'
          : 'policy_denied'
    },
  })
}

export function buildMerchantAiUpdates(deps: Deps) {
  const receipts = createMerchantAiNoticeUpdateStore(deps.db)
  const isCurrentAccountAdmin = async (input: Reader) =>
    (await getMemberRole(deps.db, input.organizationId, input.actorUserId)) === 'owner'
  const updates = createMerchantAiNoticeUpdates({
    store: receipts,
    isCurrentAccountAdmin,
  })
  return {
    pauseReason,
    latestForOverview: async (input: Reader) =>
      (await isCurrentAccountAdmin(input))
        ? receipts.latest({ ...input, unseenOnly: false })
        : null,
    renewal: renewLapsedMerchantAiAuthorizations({
      ...deps,
      store: renewalStore(deps),
      target: {
        noticeVersion: MERCHANT_AI_NOTICE.version,
        noticeDigest: MERCHANT_AI_NOTICE.digest,
      },
      captureUnexpected: (error) =>
        captureObservabilityException(error, {
          source: 'bullmq-job',
          jobName: 'merchant-ai-standing-renewal',
        }),
    }),
    updates,
  }
}
