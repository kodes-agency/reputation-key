// The Portals page's stories share one Property: Avela Resort, six Portals in two
// groups and one outside them, as boards 01 and 10 draw it. The results for the
// same Portals are in `portal-overview/portal-overview-results-fixtures.ts`.
import { useState } from 'react'
import { PortalListPage, type PortalListPageProps } from './portal-list-page'
import {
  NO_CODE,
  overviewGroup,
  overviewRow,
} from './portal-overview/portal-overview-fixtures'
import type { PortalOverviewSearch } from './portal-overview/portal-overview-search-schema'
import type { Action } from '#/components/hooks/use-action'

// The page is presentational: the route owns the URL. A story keeps the search
// in state so the toolbar, the pager and "Clear" behave as they do in the route.
export function ControlledPage(
  props: Omit<PortalListPageProps, 'search' | 'onSearchChange'>,
) {
  const [search, setSearch] = useState<PortalOverviewSearch>({})
  return <PortalListPage {...props} search={search} onSearchChange={setSearch} />
}

export const action = <TInput,>(): Action<TInput> =>
  Object.assign(async (_input: TInput) => undefined, {
    isPending: false,
    error: null,
    isSuccess: false,
    data: null,
  })

export const poolSide = overviewGroup('group-pool', 'Pool side')
export const frontOfHouse = overviewGroup('group-front', 'Front of house')

export const rows = [
  overviewRow('p-terrace', {
    name: 'Pool & Terrace',
    group: poolSide,
    additionalGuestLocales: ['bg', 'es', 'de'],
    pendingChangeCount: 2,
    responsibleManagerUserIds: ['u-georgi', 'u-elena'],
  }),
  overviewRow('p-spa', {
    name: 'Spa & thermal pools',
    group: poolSide,
    additionalGuestLocales: ['bg'],
    responsibleManagerUserIds: [],
    token: { ...overviewRow('x').token, qualifiedScanReady: false },
  }),
  overviewRow('p-bar', {
    name: 'Pool bar',
    group: poolSide,
    publicationState: 'draft',
    additionalGuestLocales: ['bg'],
    token: NO_CODE,
    responsibleManagerUserIds: ['u-elena'],
  }),
  overviewRow('p-reception', {
    name: 'Reception',
    group: frontOfHouse,
    additionalGuestLocales: ['bg'],
    responsibleManagerUserIds: ['u-georgi', 'u-elena'],
  }),
  overviewRow('p-rooms', {
    name: 'Guest rooms',
    group: frontOfHouse,
    responsibleManagerUserIds: ['u-elena'],
  }),
  overviewRow('p-olive', {
    name: 'Olive Terrace restaurant',
    additionalGuestLocales: ['bg'],
    responsibleManagerUserIds: ['u-georgi'],
  }),
]

const members = [
  { userId: 'u-georgi', name: 'Georgi Ivanov' },
  { userId: 'u-elena', name: 'Elena Petrova' },
]

export const baseArgs = {
  rows,
  members,
  propertyId: 'prop-1',
  propertyName: 'Avela Resort',
  archiveMutation: action<{
    data: { portalId: string; publicationState: 'archived' }
  }>(),
  restoreMutation: action<{
    data: { portalId: string; publicationState: 'disabled' }
  }>(),
  groups: [poolSide, frontOfHouse],
  createMutation: action<{
    data: { propertyId: string; name: string; portalIds?: string[] }
  }>(),
  renameMutation: action<{ data: { portalGroupId: string; name: string } }>(),
  archiveGroupMutation: action<{ data: { portalGroupId: string } }>(),
}
