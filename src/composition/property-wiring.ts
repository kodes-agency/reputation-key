import { randomUUID } from 'node:crypto'
import { buildPropertyContext } from '#/contexts/property/build'
import { createPropertyRepository } from '#/contexts/property/infrastructure/repositories/property.repository'
import { getLogger } from '#/shared/observability/logger'
import type { buildIdentityContext } from '#/contexts/identity/build'
import { reputationReplyScopeEffects } from './reply-scope-effects'
import type { ContextWiringInput } from './runtime'

export function wireProperty(
  { db, outboxRepo, clock }: ContextWiringInput,
  identity: ReturnType<typeof buildIdentityContext>,
) {
  const property = buildPropertyContext({
    db,
    replyEffects: reputationReplyScopeEffects,
    repo: createPropertyRepository(db),
    outboxRepo,
    clock,
    idGen: randomUUID,
    staffPublicApi: identity.publicApi.people,
    identityManagerFacts: identity.publicApi.managerFacts,
    logger: getLogger(),
  })

  return property
}
