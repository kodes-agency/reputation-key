// Identity context — public API surface for cross-context consumers.
// Other contexts consume only what is exported here. Per ADR-0001.

import type { ManagerMembership } from './members/auth-identity.port.server'

export { STAFF_NOTICE_VERSION } from './domain/staff-account'

export {
  type CurrentMerchantAiCapability,
  type MerchantAiSnapshot,
  type MerchantAiState,
} from './domain/merchant-ai-authorization'

export type { ManagerMembership } from './members/auth-identity.port.server'
export type { StaffPublicApi } from './staff/people-public-api.server'
export type {
  MerchantAiOverview,
  MerchantAiOverviewEntry,
} from './consent/merchant-ai-overview.server'

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
