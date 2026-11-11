// Identity context — public API surface for cross-context consumers.
// Other contexts consume only what is exported here. Per ADR-0001.

import type { ManagerMembership } from './ports/identity.port'

export { STAFF_NOTICE_VERSION } from '../domain/staff-account'

export {
  type CurrentMerchantAiCapability,
  type MerchantAiSnapshot,
  type MerchantAiState,
} from '../domain/merchant-ai-authorization'

export type { ManagerMembership } from './ports/identity.port'
export type { StaffPublicApi } from './people-public-api'
export type {
  MerchantAiOverview,
  MerchantAiOverviewEntry,
} from './use-cases/merchant-ai-overview'

/** Current manager membership facts. This facade carries no mutation authority. */
export type IdentityManagerFactsPublicApi = Readonly<{
  listActiveManagers: (organizationId: string) => Promise<readonly ManagerMembership[]>
}>

/** Current AccountAdmin authority, kept separate from general membership facts. */
export type IdentityAccountAdminAuthorityPublicApi = Readonly<{
  isCurrentAccountAdmin: (
    input: Readonly<{
      organizationId: string
      userId: string
    }>,
  ) => Promise<boolean>
}>

export {
  requireOwnStaffParticipation,
  requireStaffSelfPerson,
} from './staff-self-context'
