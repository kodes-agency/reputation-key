// Shared test fixtures — builders for common test types.
// Per patterns.md: deterministic builders so tests don't depend on random state.

import type { AuthContext } from '#/shared/domain/auth-context'
import { organizationId, userId } from '#/shared/domain/ids'

/** Build a deterministic AuthContext for tests. */
export function buildTestAuthContext(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: userId('user-00000000-0000-0000-0000-000000000001'),
    organizationId: organizationId('org-00000000-0000-0000-0000-000000000001'),
    role: 'PropertyManager',
    ...overrides,
  }
}
