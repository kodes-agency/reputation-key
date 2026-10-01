// The All properties page's rows and results for tests and stories: Avela
// Hospitality's three properties as board 10 prints them (3,420 qualified scans
// in all). Avela Resort and The Harbor Hotel are read in different zones' worth
// of days; Forma Kitchen is the property the board shows collapsed.
import type { PortalOverviewRow } from '#/contexts/portal/application/public-api'
import type { PortalResultsOverview } from '#/contexts/reporting/application/public-api'
import { portalId, propertyId } from '#/shared/domain/ids'
import { NO_CODE, overviewGroup, overviewRow } from './portal-overview-fixtures'
import {
  groupResultsRow,
  measuresOf,
  portalResultsRow,
  propertyResultsRow,
  ungroupedResultsRow,
} from './portal-overview-results-fixtures'

export const AVELA = propertyId('prop-avela')
export const HARBOR = propertyId('prop-harbor')
export const FORMA = propertyId('prop-forma')

/** What the page is given for the property heads: the names and Google's state. */
export const allPropertiesProperties = [
  { id: AVELA, name: 'Avela Resort', googleBindingState: 'active' as const },
  { id: HARBOR, name: 'The Harbor Hotel', googleBindingState: 'disconnected' as const },
  { id: FORMA, name: 'Forma Kitchen', googleBindingState: 'active' as const },
]

export const allPropertiesMembers = [
  { userId: 'u-georgi', name: 'Georgi Ivanov' },
  { userId: 'u-elena', name: 'Elena Petrova' },
  { userId: 'u-maria', name: 'Maria Koleva' },
  { userId: 'u-nikolay', name: 'Nikolay Todorov' },
]

const at = (property: typeof AVELA) => ({ propertyId: property })

const AVELA_ROWS: readonly PortalOverviewRow[] = [
  overviewRow('a-reception', {
    ...at(AVELA),
    name: 'Reception',
    additionalGuestLocales: ['bg'],
    responsibleManagerUserIds: ['u-georgi', 'u-elena'],
  }),
  overviewRow('a-terrace', {
    ...at(AVELA),
    name: 'Pool & Terrace',
    additionalGuestLocales: ['bg', 'es', 'de'],
    pendingChangeCount: 2,
    responsibleManagerUserIds: ['u-georgi', 'u-elena'],
  }),
  overviewRow('a-olive', {
    ...at(AVELA),
    name: 'Olive Terrace restaurant',
    additionalGuestLocales: ['bg'],
    pendingChangeCount: 1,
    responsibleManagerUserIds: ['u-georgi'],
  }),
  overviewRow('a-spa', {
    ...at(AVELA),
    name: 'Spa & thermal pools',
    additionalGuestLocales: ['bg'],
    responsibleManagerUserIds: [],
    token: { ...overviewRow('x').token, qualifiedScanReady: false },
  }),
  overviewRow('a-rooms', {
    ...at(AVELA),
    name: 'Guest rooms',
    responsibleManagerUserIds: ['u-elena'],
  }),
  overviewRow('a-bar', {
    ...at(AVELA),
    name: 'Pool bar',
    publicationState: 'draft',
    additionalGuestLocales: ['bg'],
    token: NO_CODE,
    responsibleManagerUserIds: ['u-elena'],
  }),
]

const harborRows = (grouped: boolean): readonly PortalOverviewRow[] => {
  const group = grouped ? overviewGroup('group-harbor', 'Front of house') : null
  return [
    overviewRow('h-terrace', {
      ...at(HARBOR),
      name: 'Terrace',
      group,
      additionalGuestLocales: ['de'],
      responsibleManagerUserIds: ['u-maria'],
    }),
    overviewRow('h-rooms', {
      ...at(HARBOR),
      name: 'Rooms',
      group,
      responsibleManagerUserIds: ['u-maria'],
    }),
    overviewRow('h-bar', {
      ...at(HARBOR),
      name: 'Harbour bar',
      additionalGuestLocales: ['de'],
      responsibleManagerUserIds: ['u-nikolay'],
    }),
  ]
}

const FORMA_ROWS: readonly PortalOverviewRow[] = [
  overviewRow('f-dining', {
    ...at(FORMA),
    name: 'Dining room',
    responsibleManagerUserIds: ['u-nikolay'],
  }),
  overviewRow('f-takeaway', {
    ...at(FORMA),
    name: 'Takeaway',
    responsibleManagerUserIds: ['u-nikolay'],
  }),
]

/** Eleven Portals in three properties. `harborGroups` puts two of The Harbor's into a group. */
export function allPropertiesRows(
  options: Readonly<{ harborGroups?: boolean }> = {},
): readonly PortalOverviewRow[] {
  return [...AVELA_ROWS, ...harborRows(options.harborGroups === true), ...FORMA_ROWS]
}

const figures = (
  scans: number,
  ratings: number,
  average: number | null,
  googleOpens: number,
  notes: number,
) => ({ scans, ratings, average, googleOpens, notes })

const AVELA_TOTAL = { priorScans: 1490, ...figures(1607, 450, 4.4, 236, 36) }
const HARBOR_TOTAL = { priorScans: 1050, ...figures(1108, 312, 4.5, 164, 21) }
const FORMA_TOTAL = { priorScans: 668, ...figures(705, 189, 4.3, 98, 14) }
const ORGANIZATION_TOTAL = { priorScans: 3208, ...figures(3420, 951, 4.4, 498, 71) }

const AVELA_FIGURES: Readonly<Record<string, ReturnType<typeof figures>>> = {
  'a-reception': figures(520, 140, 4.5, 77, 12),
  'a-terrace': figures(412, 118, 4.4, 64, 9),
  'a-olive': figures(351, 97, 4.2, 41, 11),
  'a-spa': figures(286, 91, 4.6, 52, 4),
  'a-rooms': figures(38, 4, null, 2, 0),
  'a-bar': figures(0, 0, null, 0, 0),
}
const HARBOR_FIGURES: Readonly<Record<string, ReturnType<typeof figures>>> = {
  'h-terrace': figures(486, 139, 4.6, 74, 8),
  'h-rooms': figures(402, 118, 4.5, 63, 9),
  'h-bar': figures(220, 55, 4.3, 27, 4),
}
const FORMA_FIGURES: Readonly<Record<string, ReturnType<typeof figures>>> = {
  'f-dining': figures(420, 110, 4.3, 58, 9),
  'f-takeaway': figures(285, 79, 4.3, 40, 5),
}

const portalRows = (
  property: typeof AVELA,
  byId: Readonly<Record<string, ReturnType<typeof figures>>>,
  groups: Readonly<Record<string, string>> = {},
) =>
  Object.entries(byId).map(([id, row]) =>
    portalResultsRow(id, groups[id] ?? null, measuresOf(row), property),
  )

/** The same properties' results as board 10 prints them, each in its own window. */
export function allPropertiesResults(
  options: Readonly<{ harborGroups?: boolean }> = {},
): PortalResultsOverview {
  const harborGroup = options.harborGroups === true
  const harborIds = Object.keys(HARBOR_FIGURES)
  const harborGrouped = { 'h-terrace': 'group-harbor', 'h-rooms': 'group-harbor' }
  return {
    qualifiedScansSince: new Date('2026-08-01T00:00:00.000Z'),
    thresholds: { averageMinSample: 5, comparisonMinSample: 10 },
    properties: [
      propertyResultsRow(Object.keys(AVELA_FIGURES), measuresOf(AVELA_TOTAL), {
        propertyId: AVELA,
      }),
      propertyResultsRow(harborIds, measuresOf(HARBOR_TOTAL), { propertyId: HARBOR }),
      propertyResultsRow(Object.keys(FORMA_FIGURES), measuresOf(FORMA_TOTAL), {
        propertyId: FORMA,
      }),
    ],
    portals: [
      ...portalRows(AVELA, AVELA_FIGURES),
      ...portalRows(HARBOR, HARBOR_FIGURES, harborGroup ? harborGrouped : {}),
      ...portalRows(FORMA, FORMA_FIGURES),
    ],
    groups: harborGroup
      ? [
          groupResultsRow(
            'group-harbor',
            ['h-terrace', 'h-rooms'],
            measuresOf(figures(888, 257, 4.6, 137, 17)),
            ['h-terrace', 'h-rooms'],
            HARBOR,
          ),
        ]
      : [],
    ungrouped: [
      ungroupedResultsRow(Object.keys(AVELA_FIGURES), measuresOf(AVELA_TOTAL), AVELA),
      harborGroup
        ? ungroupedResultsRow(['h-bar'], measuresOf(HARBOR_FIGURES['h-bar']!), HARBOR)
        : ungroupedResultsRow(harborIds, measuresOf(HARBOR_TOTAL), HARBOR),
      ungroupedResultsRow(Object.keys(FORMA_FIGURES), measuresOf(FORMA_TOTAL), FORMA),
    ],
    total: {
      portalIds: [
        ...Object.keys(AVELA_FIGURES),
        ...harborIds,
        ...Object.keys(FORMA_FIGURES),
      ].map(portalId),
      ...measuresOf(ORGANIZATION_TOTAL),
    },
  }
}
