// Integration context — property FK cleanup port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// Used by the google-connection repository to clear FK references in the Property table
// without the integration context directly accessing Property's database tables.

import type { GoogleConnectionId, OrganizationId } from '#/shared/domain/ids'

export type PropertyFkCleanupPort = Readonly<{
  /** Null out all googleConnectionId references for a given connection. */
  clearGoogleConnectionRef: (
    orgId: OrganizationId,
    connectionId: GoogleConnectionId,
  ) => Promise<void>
}>
