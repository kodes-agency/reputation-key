// Inbox context — unread counter port (Redis-backed)
// Per architecture: "Ports are TypeScript interfaces, not classes."

import type { OrganizationId, UserId } from '#/shared/domain/ids'

export type UnreadCounterPort = Readonly<{
  getCount(orgId: OrganizationId, userId: UserId): Promise<number>
  setCount(orgId: OrganizationId, userId: UserId, count: number): Promise<void>
  increment(orgId: OrganizationId, userId: UserId): Promise<void>
  decrement(orgId: OrganizationId, userId: UserId): Promise<void>
  invalidate(orgId: OrganizationId, userId: UserId): Promise<void>
}>
