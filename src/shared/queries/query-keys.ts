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
  newCount: () => [...inboxKeys.all, 'new-count'] as const,
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
}
