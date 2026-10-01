// "Pool side" at Avela Resort as board 13 draws it, for stories: three portals,
// a September goal at 209 of 250 on the last day of the month, and a history of a
// creation (with a portal that moved in from Wellness) and a rename.
import type { PortalGroupHistoryEntry } from '#/contexts/portal/application/public-api'
import type { GoalProgress } from '#/contexts/reporting/application/public-api'
import { organizationId, portalGroupId, portalId, propertyId } from '#/shared/domain/ids'
import { rows } from '../portal-list-page-stories-data'
import type { HistoryNames } from './portal-group-history-view'
import type { ReadState } from './portal-group-read-state'

export const POOL_SIDE = { id: 'group-pool', name: 'Pool side' } as const
export const POOL_SIDE_ROWS = rows
export const NOW = new Date('2026-09-30T08:00:00.000Z')
export const ZONE = 'Europe/Sofia'

const entry = (
  id: string,
  at: string,
  overrides: Partial<PortalGroupHistoryEntry> & Pick<PortalGroupHistoryEntry, 'kind'>,
): PortalGroupHistoryEntry => ({
  id,
  organizationId: organizationId('org-1'),
  propertyId: propertyId('prop-1'),
  portalGroupId: portalGroupId(POOL_SIDE.id),
  portalId: null,
  otherGroupId: null,
  name: null,
  previousName: null,
  actorUserId: 'u-elena',
  occurredAt: new Date(at),
  ...overrides,
})

const CREATED = '2026-08-12T09:00:00.000Z'

export const HISTORY: readonly PortalGroupHistoryEntry[] = [
  entry('h-rename', '2026-08-14T08:00:00.000Z', {
    kind: 'renamed',
    name: 'Pool side',
    previousName: 'Pools',
    actorUserId: 'u-georgi',
  }),
  entry('h-spa', CREATED, {
    kind: 'portal_moved_in',
    portalId: portalId('p-spa'),
    otherGroupId: portalGroupId('group-wellness'),
  }),
  entry('h-terrace', CREATED, { kind: 'portal_added', portalId: portalId('p-terrace') }),
  entry('h-bar', CREATED, { kind: 'portal_added', portalId: portalId('p-bar') }),
  entry('h-created', CREATED, { kind: 'created', name: 'Pools' }),
]

export const NAMES: HistoryNames = {
  actor: (userId) =>
    ({ 'u-georgi': 'Georgi Ivanov', 'u-elena': 'Elena Petrova' })[userId] ?? null,
  portal: (id) => rows.find((row) => row.portalId === id)?.name ?? null,
  group: (id) => (id === 'group-wellness' ? 'Wellness' : null),
}

export const PEOPLE = (userId: string): string | null => NAMES.actor(userId)

const SEPTEMBER = {
  start: new Date('2026-08-31T21:00:00.000Z'),
  end: new Date('2026-09-30T21:00:00.000Z'),
}

export const RATINGS_GOAL: GoalProgress = {
  programId: 'goal-ratings',
  name: 'Private ratings',
  metric: 'portal_rating_count',
  targetValue: 250,
  setBy: 'u-elena',
  status: 'active',
  period: SEPTEMBER,
  timezone: ZONE,
  asOf: NOW,
  reading: { kind: 'live', value: 209, sampleCount: 209 },
}

export const ready = <T>(data: T): ReadState<T> => ({ status: 'ready', data })
