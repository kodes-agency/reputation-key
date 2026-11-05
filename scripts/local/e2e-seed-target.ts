// What the acceptance seeder checks before it writes a row or clears a key: the
// committed e2e environment claimed the seeder's execution identity, and the
// database and Redis it names are on this machine (local-only-database.ts).

import { assertLocalToolExecutionIdentity } from '../../src/shared/config/local-tool-execution'
import { assertLocalOnlyDatabase, assertLocalOnlyRedis } from './local-only-database'

export function assertLocalE2eSeedTarget(
  env: Readonly<Record<string, string | undefined>>,
): void {
  assertLocalToolExecutionIdentity(env)
  assertLocalOnlyDatabase(env)
  assertLocalOnlyRedis(env)
}
