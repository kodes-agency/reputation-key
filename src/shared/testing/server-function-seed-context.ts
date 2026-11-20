// What a server-function harness seed family receives from the harness.

import type { Pool } from 'pg'
import type { Clock } from '#/shared/domain/clock'

export type HarnessSeedContext = Readonly<{
  pool: () => Pool
  /** The container's clock. */
  clock: Clock
  newId: () => string
  /** Delete this Organization, and what hangs off it, after the test. */
  trackOrganization: (organizationId: string) => void
  /** Delete this user after the test. */
  trackUser: (userId: string) => void
  /** Seal a Google token under ENCRYPTION_KEY, when the file supplied the app's adapter. */
  sealGoogleToken?: (token: string) => string
}>
