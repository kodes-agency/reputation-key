// BQC-2.3 — accessible-property lookup port.
//
// The ONLY source of property-access scope: the identity-owned
// PropertyAccessGrant repository (ADR 0039 — authorization never derives
// from team membership, portal responsibility, or staff participation).
// Wired in the composition root to the grant-backed identity adapter.
//
// Contract: returns the caller's granted property ids; empty array when the
// caller has no grants (missing scope = deny downstream, never an
// organization-wide allow). Never returns null and never swallows errors —
// a failed lookup throws, failing the request closed.

import type { OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'

export type AccessiblePropertyLookupPort = (
  orgId: OrganizationId,
  userId: UserId,
) => Promise<ReadonlyArray<PropertyId>>
