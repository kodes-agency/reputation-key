// Test support for read use cases that authorize their reader first.

import type { AuthContext } from '#/shared/domain/auth-context'
import type { OrganizationId } from '#/shared/domain/ids'
import { buildTestAuthContext } from './fixtures'

/**
 * Runs an authorized read as an AccountAdmin of the Organization each input
 * names, so a test of what the read returns stays about the read. The
 * authorize step has tests of its own beside each use case.
 */
export const asAccountAdmin =
  <TInput extends Readonly<{ organizationId: OrganizationId }>, TOutput>(
    read: (input: TInput, ctx: AuthContext) => Promise<TOutput>,
  ) =>
  (input: TInput): Promise<TOutput> =>
    read(
      input,
      buildTestAuthContext({
        organizationId: input.organizationId,
        role: 'AccountAdmin',
      }),
    )
