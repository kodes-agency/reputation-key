// Every seed the server-function harness offers, by family.

import { goalSeeds, type GoalSeeds } from './server-function-goal-seeds'
import { identitySeeds, type IdentitySeeds } from './server-function-identity-seeds'
import { portalSeeds, type PortalSeeds } from './server-function-portal-seeds'
import { propertySeeds, type PropertySeeds } from './server-function-property-seeds'
import { reviewSeeds, type ReviewSeeds } from './server-function-review-seeds'
import type { HarnessSeedContext } from './server-function-seed-context'

export type { HarnessSeedContext } from './server-function-seed-context'
export type {
  TestInvitation,
  TestMember,
  TestOrganization,
  TestUser,
} from './server-function-identity-seeds'
export type { TestPortal, TestProperty } from './server-function-property-seeds'
export type {
  TestPublishedPortal,
  TestStaffParticipation,
} from './server-function-portal-seeds'
export type { TestInboxItem, TestReply, TestReview } from './server-function-review-seeds'

export type HarnessSeeds = GoalSeeds &
  IdentitySeeds &
  PropertySeeds &
  PortalSeeds &
  ReviewSeeds

export function createHarnessSeeds(context: HarnessSeedContext): HarnessSeeds {
  return {
    ...goalSeeds(context),
    ...identitySeeds(context),
    ...propertySeeds(context),
    ...portalSeeds(context),
    ...reviewSeeds(context),
  }
}
