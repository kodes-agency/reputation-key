// The authority contract the atomic inbox command store asks inside every
// write transaction (BQC-3.4): which principals must hold which permissions at
// which Property, decided against the transaction's own snapshot. Types only,
// split out of inbox-command-store.ts so the store's helper modules can name
// the contract without importing the store back. The store re-exports them, so
// its importers are unchanged.

import type { Permission } from '#/shared/domain/permissions'
import type { Tx } from '#/shared/outbox/commit'

export type InboxCommandAuthorityPrincipal = Readonly<{
  userId: string
  permissions: readonly Permission[]
  purpose: 'actor' | 'assignee'
}>

export type InboxCommandAuthorityRequirement = InboxCommandAuthorityPrincipal &
  Readonly<{ propertyId: string }>

export type InboxCommandAuthority = (
  tx: Tx,
  input: Readonly<{
    organizationId: string
    at: Date
    requirements: readonly InboxCommandAuthorityRequirement[]
  }>,
) => Promise<Readonly<{ allowed: true }> | Readonly<{ allowed: false; reason: string }>>
