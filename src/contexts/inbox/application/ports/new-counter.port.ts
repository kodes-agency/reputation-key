// Inbox context — new counter port (Redis-backed)
// Per architecture: "Ports are TypeScript interfaces, not classes."
//
// Design note: New count is org-level, NOT per-user.
// Inbox items have a shared status field (`new` → `read` → …) with no per-user
// read tracking. All users in an org see the same "new" items, so the counter
// is scoped to orgId only. If per-user read state is added later (Phase N+),
// this port will need userId reintroduced.

import type { OrganizationId } from '#/shared/domain/ids'

export type NewCounterPort = Readonly<{
  getCount(orgId: OrganizationId): Promise<number>
  setCount(orgId: OrganizationId, count: number): Promise<void>
  increment(orgId: OrganizationId): Promise<void>
  decrement(orgId: OrganizationId): Promise<void>
  decrementBy(orgId: OrganizationId, count: number): Promise<void>
  invalidate(orgId: OrganizationId): Promise<void>
}>
