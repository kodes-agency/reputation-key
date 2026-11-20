// Portal's reaction to a member's removal: release, from the fact that commits
// with the membership delete, what the member may no longer hold here
// (`releaseRemovedMemberResponsibilities`, bound in build.ts).

import type { ConsumerRegistry } from '#/shared/outbox'
import {
  removedMemberConsumerHandler,
  type RemovedMemberConsumerDeps,
} from '#/shared/removed-member-consumer'

export type PortalMemberOffboardingConsumerDeps = Pick<
  RemovedMemberConsumerDeps,
  'release' | 'receipts'
>

export function registerPortalMemberOffboardingConsumers(
  registry: ConsumerRegistry,
  deps: PortalMemberOffboardingConsumerDeps,
): void {
  const { registerConsumer } = registry
  // Consumer names MUST stay string literals here — the event-job catalogue
  // guard discovers durable consumers by scanning registerConsumer calls.
  registerConsumer({
    eventType: 'identity.member.removed',
    consumerName: 'portal.on-member-removed',
    module: 'portal.member-offboarding',
    handler: removedMemberConsumerHandler({
      ...deps,
      consumerName: 'portal.on-member-removed',
    }),
  })
}
