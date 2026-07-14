// Query-key factories — centralized so cache invalidation stays targeted.
//
// Convention: each context/feature exposes a factory whose keys form a hierarchy
// (parent keys are prefixes of child keys), so `invalidateQueries(parentKey)`
// refreshes all descendants. See TanStack Query "Query Keys" docs.
//
// Populated as features migrate to TanStack Query (inbox pilot first).

export const inboxKeys = {
  all: ['inbox'] as const,
  lists: () => [...inboxKeys.all, 'list'] as const,
  list: (filters: Readonly<Record<string, unknown>>) =>
    [...inboxKeys.lists(), filters] as const,
  counts: () => [...inboxKeys.all, 'counts'] as const,
  lastVisitCount: () => [...inboxKeys.all, 'last-visit-count'] as const,
  details: () => [...inboxKeys.all, 'item'] as const,
  detail: (id: string) => [...inboxKeys.details(), id] as const,
  notes: (id: string) => [...inboxKeys.detail(id), 'notes'] as const,
  activity: (id: string) => [...inboxKeys.detail(id), 'activity'] as const,
}

export const notificationKeys = {
  all: ['notifications'] as const,
  count: () => [...notificationKeys.all, 'count'] as const,
  lists: () => [...notificationKeys.all, 'list'] as const,
  list: (limit: number) => [...notificationKeys.lists(), { limit }] as const,
  preferences: () => [...notificationKeys.all, 'preferences'] as const,
}

// ── Identity / organization context ────────────────────────────────────
export const identityKeys = {
  all: ['identity'] as const,
  organizations: () => [...identityKeys.all, 'organizations'] as const,
  activeOrg: () => [...identityKeys.all, 'active-org'] as const,
  responseSla: () => [...identityKeys.all, 'response-sla'] as const,
  members: () => [...identityKeys.all, 'members'] as const,
  invitations: () => [...identityKeys.all, 'invitations'] as const,
}

// ── Properties ──────────────────────────────────────────────────────────
export const propertyKeys = {
  all: ['properties'] as const,
  list: () => [...propertyKeys.all, 'list'] as const,
  detail: (propertyId: string) => [...propertyKeys.all, 'detail', propertyId] as const,
}

// ── Dashboard (fleet + per-property + staff) ─────────────────────────────
export const dashboardKeys = {
  all: ['dashboard'] as const,
  fleet: () => [...dashboardKeys.all, 'fleet'] as const,
  staff: (args: Readonly<Record<string, unknown>>) =>
    [...dashboardKeys.all, 'staff', args] as const,
  property: (args: Readonly<Record<string, unknown>>) =>
    [...dashboardKeys.all, 'property', args] as const,
  signals: (args: Readonly<Record<string, unknown>>) =>
    [...dashboardKeys.all, 'signals', args] as const,
}

// ── Goals ────────────────────────────────────────────────────────────────
export const goalKeys = {
  all: ['goals'] as const,
  staff: (propertyId: string) => [...goalKeys.all, 'staff', propertyId] as const,
  list: (args: Readonly<Record<string, unknown>>) =>
    [...goalKeys.all, 'list', args] as const,
  detail: (goalId: string) => [...goalKeys.all, 'detail', goalId] as const,
}

// ── Leaderboard ──────────────────────────────────────────────────────────
export const leaderboardKeys = {
  all: ['leaderboard'] as const,
  matrix: (args: Readonly<Record<string, unknown>>) =>
    [...leaderboardKeys.all, 'matrix', args] as const,
  board: (args: Readonly<Record<string, unknown>>) =>
    [...leaderboardKeys.all, 'board', args] as const,
}

// ── Staff (assignments + staff-visible portals) ──────────────────────────
export const staffKeys = {
  all: ['staff'] as const,
  assignments: (propertyId: string) =>
    [...staffKeys.all, 'assignments', propertyId] as const,
  portals: (propertyId: string) => [...staffKeys.all, 'portals', propertyId] as const,
}

// ── Reviews (staff recent activity) ──────────────────────────────────────
export const reviewKeys = {
  all: ['reviews'] as const,
  staffActivity: (propertyId: string) =>
    [...reviewKeys.all, 'staff-activity', propertyId] as const,
}

// ── Teams ─────────────────────────────────────────────────────────────────
export const teamKeys = {
  all: ['teams'] as const,
  list: (propertyId: string) => [...teamKeys.all, 'list', propertyId] as const,
}

// ── Portals (detail + links + groups) ────────────────────────────────────
export const portalKeys = {
  all: ['portals'] as const,
  list: (propertyId: string) => [...portalKeys.all, 'list', propertyId] as const,
  detail: (portalId: string) => [...portalKeys.all, 'detail', portalId] as const,
  links: (portalId: string) => [...portalKeys.detail(portalId), 'links'] as const,
  groups: (propertyId: string) => [...portalKeys.all, 'groups', propertyId] as const,
}

// ── Badges / recognition ─────────────────────────────────────────────────
export const badgeKeys = {
  all: ['badges'] as const,
  staffVisible: (propertyId: string) =>
    [...badgeKeys.all, 'staff-visible', propertyId] as const,
  target: (args: Readonly<Record<string, unknown>>) =>
    [...badgeKeys.all, 'target', args] as const,
  orgDefinitions: () => [...badgeKeys.all, 'org-definitions'] as const,
}

// ── Integrations (Google connections + import jobs) ──────────────────────
export const integrationKeys = {
  all: ['integrations'] as const,
  connections: () => [...integrationKeys.all, 'connections'] as const,
  import: (importId: string) => [...integrationKeys.all, 'import', importId] as const,
}

// ── Guest / public portal ────────────────────────────────────────────────
export const guestKeys = {
  all: ['guest'] as const,
  publicPortal: (args: Readonly<Record<string, unknown>>) =>
    [...guestKeys.all, 'public-portal', args] as const,
}
