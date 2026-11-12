import { randomUUID } from 'node:crypto'
import { buildReviewContext } from '#/contexts/review/build'
import { reputationReplyScopeEffects } from './reply-scope-effects'
import { getLogger } from '#/shared/observability/logger'
import type { buildIdentityContext } from '#/contexts/identity/build'
import type { buildPropertyContext } from '#/contexts/property/build'
import type { buildPortalContext } from '#/contexts/portal/build'
import type { IntegrationContextApi } from '#/contexts/integration/build'
import type { buildAiRuntime } from './ai-wiring'
import type { ContextWiringInput } from './runtime'

export function wireReview(
  {
    db,
    outboxRepo,
    clock,
    pool,
    infra,
    reviewProviderSubjectKeyring,
  }: ContextWiringInput,
  identity: ReturnType<typeof buildIdentityContext>,
  property: ReturnType<typeof buildPropertyContext>,
  portal: ReturnType<typeof buildPortalContext>,
  integration: IntegrationContextApi,
  aiRuntime: ReturnType<typeof buildAiRuntime>,
) {
  const review = buildReviewContext({
    db,
    replyEffects: reputationReplyScopeEffects,
    outboxRepo,
    clock,
    idGen: randomUUID,
    snapshotRunIdGen: randomUUID,
    staffPublicApi: identity.publicApi.people,
    publicationActorAuthority: async (tx, authorityInput) =>
      (await identity.authority.decidePublicationActorAuthority(tx, authorityInput))
        .allowed,
    googleReviewApi: integration.reviewSync.googleReviewApi,
    googleConnectionStatus: integration.reviewSync.googleConnectionStatus,
    targetedReviewReferences: integration.reviewSync.googleReviewPushTargetResolver,
    jobQueue: infra.jobQueue,
    workerRuntime: {
      pool,
      registry: infra.jobRegistry,
      backgroundQueue: infra.backgroundQueue,
    },
    logger: getLogger(),
    propertyApi: property.publicApi,
    providerSubjectKeyring: reviewProviderSubjectKeyring,
    aiReplyProvenancePublicKeys: aiRuntime.provenancePublicKeys,
    replyBrandProfiles: portal.publicApi.portal,
  })
  return review
}
