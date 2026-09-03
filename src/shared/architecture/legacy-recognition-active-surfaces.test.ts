import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const ROUTES = join(ROOT, 'src', 'routes')
const COMPONENTS = join(ROOT, 'src', 'components')
const SETTINGS_BARREL = join(
  ROOT,
  'src',
  'components',
  'features',
  'settings',
  'index.ts',
)
const LEGACY_RECOGNITION_SETTINGS_UI = [
  join(
    ROOT,
    'src',
    'components',
    'features',
    'settings',
    'recognition-settings-page.tsx',
  ),
  join(
    ROOT,
    'src',
    'components',
    'features',
    'settings',
    'recognition-activation-card.tsx',
  ),
]
const LEGACY_BADGE_DISPLAY_UI = [
  join(ROOT, 'src', 'components', 'features', 'badges', 'staff-badge-summary.tsx'),
  join(ROOT, 'src', 'components', 'features', 'badges', 'portal-badge-section.tsx'),
]
const LEGACY_CONTEXT_BUILDS = [
  'src/contexts/badge/build.ts',
  'src/contexts/team/build.ts',
  'src/contexts/leaderboard/build.ts',
] as const

// LIF-01: the Organization Export contract requires a contribution from all 17
// contexts, so a dark context still owns a read-only export adapter. Each one is
// a `SELECT`-only reader of its own retained rows: it constructs no repository,
// registers no consumer or job, and is deliberately unreachable from the inert
// build boundary asserted below. Adding a row here widens the retained-source
// inventory by exactly that one reader — it does not relax any darkness rule.
// @proof GOAL_RECOGNITION_RUNTIME#3
const RETAINED_RECOGNITION_PRODUCTION_SOURCES = [
  'src/contexts/badge/application/public-api.ts',
  'src/contexts/badge/build.ts',
  'src/contexts/badge/domain/events.ts',
  'src/contexts/badge/infrastructure/adapters/badge-organization-export.adapter.ts',
  'src/contexts/badge/infrastructure/adapters/badge-organization-lifecycle.adapter.ts',
  'src/contexts/leaderboard/application/legacy-recognition-inventory.ts',
  'src/contexts/leaderboard/application/public-api.ts',
  'src/contexts/leaderboard/build.ts',
  'src/contexts/leaderboard/infrastructure/adapters/leaderboard-organization-export.adapter.ts',
  'src/contexts/leaderboard/infrastructure/adapters/leaderboard-organization-lifecycle.adapter.ts',
  'src/contexts/leaderboard/infrastructure/legacy-recognition-inventory.repository.ts',
] as const

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) return []
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) return []
    return [path]
  })
}

function legacyRecognitionReferences(path: string): string[] {
  const body = readFileSync(path, 'utf8')
  return [
    '#/contexts/badge/',
    '#/contexts/leaderboard/',
    '#/components/features/badges/',
    '#/components/features/settings/recognition-',
  ].filter((marker) => body.includes(marker))
}

describe('legacy recognition stays out of active beta surfaces', () => {
  it('retains only historical decoding and content-free inventory code', () => {
    // @proof GOAL_RECOGNITION_RUNTIME#1
    const retainedSources = [
      ...sourceFiles(join(SRC, 'contexts', 'badge')),
      ...sourceFiles(join(SRC, 'contexts', 'leaderboard')),
    ]
      .map((path) => relative(ROOT, path))
      .sort()

    expect(retainedSources).toEqual([...RETAINED_RECOGNITION_PRODUCTION_SOURCES].sort())
  })

  it('keeps every legacy-dark context build as an inert inventory boundary', () => {
    const forbiddenConstructionMarkers = [
      'createBadgeRepository',
      'createRecognitionRepository',
      'registerBadgeEventHandlers',
      'registerRecognitionEventHandlers',
      'seedBadgeDefinitions',
      'evaluateBadgeForTarget',
      'reconcileBadgeDefinitions',
      'createRecognitionUseCases',
    ] as const

    for (const path of LEGACY_CONTEXT_BUILDS) {
      const body = readFileSync(join(ROOT, path), 'utf8')
      expect(
        forbiddenConstructionMarkers
          .filter((marker) => body.includes(marker))
          .map((marker) => `${path}: ${marker}`),
      ).toEqual([])
      expect(body, path).toContain('publicApi: {}')
      expect(body, path).toContain('useCases: {}')
    }
  })

  it('retains no Team network/UI surface or positive beta fixture journey', () => {
    const forbiddenPaths = [
      'src/contexts/team/server/teams.ts',
      'src/contexts/team/server/property-scope.ts',
      'src/routes/_authenticated/properties/$propertyId/teams.tsx',
      'e2e/team-management.spec.ts',
    ] as const
    expect(forbiddenPaths.filter((path) => existsSync(join(ROOT, path)))).toEqual([])

    const seedPath = 'scripts/seed-e2e-user.ts'
    const seed = readFileSync(join(ROOT, seedPath), 'utf8')
    const forbiddenSeedMarkers = [
      "from '../src/shared/db/schema/team.schema'",
      'teamMemberships',
      'teamPortalGroupScopes',
      'ensurePeopleAndTeamFixtures',
      'p1Team',
      'teamId:',
    ] as const
    expect(
      forbiddenSeedMarkers
        .filter((marker) => seed.includes(marker))
        .map((marker) => `${seedPath}: ${marker}`),
    ).toEqual([])

    const stalePositiveJourneys = [
      'e2e/navigation.spec.ts',
      'e2e/staff-assignment.spec.ts',
      'e2e/helpers/cleanup.ts',
    ].flatMap((path) => {
      const body = readFileSync(join(ROOT, path), 'utf8')
      return [
        "from '#/shared/db/schema/team.schema'",
        'from team-management.spec.ts',
        "like(teams.name, 'Front Desk %')",
        "tab', { name: /teams/i",
        'promoted P1 People, Portal, Team',
      ].flatMap((marker) => (body.includes(marker) ? [`${path}: ${marker}`] : []))
    })
    expect(stalePositiveJourneys).toEqual([])
  })

  it('keeps retained Team membership writes inside the unreachable Team context', () => {
    const teamMembershipWrite =
      /\.(?:insert|update|delete)\(\s*teamMemberships\b|\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+team_memberships\b/iu
    const externalWriters = sourceFiles(SRC)
      .filter((path) => !path.startsWith(join(SRC, 'contexts', 'team')))
      .filter((path) => teamMembershipWrite.test(readFileSync(path, 'utf8')))
      .map((path) => relative(ROOT, path))

    expect(externalWriters).toEqual([])
  })

  it('does not construct, expose, seed, or schedule legacy recognition at runtime', () => {
    const productionRoots = [
      'src/composition.ts',
      'src/bootstrap.ts',
      'scripts/seed.ts',
    ] as const
    const forbiddenRuntimeMarkers = [
      'buildBadgeContext',
      'buildLeaderboardContext',
      'buildTeamContext',
      'badgePublicApi',
      'leaderboardPublicApi',
      'seedBadgeDefinitions',
      'reconcileBadgeDefinitions',
      'reconcileRecognition',
      'listRecognitionScopes',
      "registerCapabilityGatedJob('leaderboard.reconcile'",
    ] as const

    const violations = productionRoots.flatMap((path) => {
      const body = readFileSync(join(ROOT, path), 'utf8')
      return forbiddenRuntimeMarkers
        .filter((marker) => body.includes(marker))
        .map((marker) => `${path}: ${marker}`)
    })

    expect(violations).toEqual([])
  })

  it('does not manufacture active Recognition data or positive journeys in beta E2E', () => {
    const seedPath = 'scripts/seed-e2e-user.ts'
    const journeyPath = 'e2e/critical/beta-product-journeys.spec.ts'
    const seed = readFileSync(join(ROOT, seedPath), 'utf8')
    const journeys = readFileSync(join(ROOT, journeyPath), 'utf8')
    const forbiddenSeedMarkers = [
      'governedBadgeAwards',
      'recognitionActivations',
      'recognitionActivationGroups',
      'recognitionBoardSnapshots',
      'recognitionBoardEntries',
      'recognitionReading',
      'badgeDefinitionId',
    ]
    const forbiddenPositiveJourneyMarkers = [
      'recognition activation settings and governed P1 group board persist',
      'Staff reads its P1 group board',
      "getByRole('heading', { name: 'Recognition board' })).toBeVisible()",
    ]

    expect(
      forbiddenSeedMarkers
        .filter((marker) => seed.includes(marker))
        .map((marker) => `${seedPath}: ${marker}`),
    ).toEqual([])
    expect(
      forbiddenPositiveJourneyMarkers
        .filter((marker) => journeys.includes(marker))
        .map((marker) => `${journeyPath}: ${marker}`),
    ).toEqual([])
  })

  it('removes legacy network and consumer declarations completely', () => {
    // @proof GOAL_RECOGNITION_RUNTIME#2
    const removedDeclarations = [
      'src/contexts/badge/server/badges.ts',
      'src/contexts/badge/infrastructure/event-handlers/index.ts',
      'src/contexts/leaderboard/server/leaderboards.ts',
      'src/contexts/leaderboard/infrastructure/event-handlers/index.ts',
    ] as const
    expect(removedDeclarations.filter((path) => existsSync(join(ROOT, path)))).toEqual([])
    expect(
      readFileSync(join(ROOT, 'src/contexts/badge/application/public-api.ts'), 'utf8'),
    ).not.toMatch(/export\s*\{[^}]*\bbadgeAwarded\b/u)
  })

  it('keeps active routes independent from Badge and Leaderboard runtime reads', () => {
    const violations = sourceFiles(ROUTES)
      .map((path) => relative(ROOT, path))
      .flatMap((path) =>
        legacyRecognitionReferences(join(ROOT, path)).map(
          (reference) => `${path}: ${reference}`,
        ),
      )

    expect(violations).toEqual([])
  })

  it('keeps the active Staff Home query bundle independent from legacy awards', () => {
    const path = 'src/components/features/staff/use-staff-home-data.ts'
    expect(
      legacyRecognitionReferences(join(ROOT, path)).map(
        (reference) => `${path}: ${reference}`,
      ),
    ).toEqual([])
  })

  it('retains no legacy Recognition settings presentation owner or importer', () => {
    const retainedModules = LEGACY_RECOGNITION_SETTINGS_UI.filter(existsSync).map(
      (path) => relative(ROOT, path),
    )
    const legacyImportMarkers = [
      'RecognitionSettingsPage',
      'recognition-settings-page',
      'recognition-activation-card',
    ]
    const importers = [...sourceFiles(COMPONENTS), ...sourceFiles(ROUTES)]
      .filter((path) => !LEGACY_RECOGNITION_SETTINGS_UI.includes(path))
      .flatMap((path) => {
        const body = readFileSync(path, 'utf8')
        return legacyImportMarkers
          .filter((marker) => body.includes(marker))
          .map((marker) => `${relative(ROOT, path)}: ${marker}`)
      })

    expect({
      importers,
      retainedModules,
      settingsBarrelExportsLegacyUi: legacyImportMarkers.some((marker) =>
        readFileSync(SETTINGS_BARREL, 'utf8').includes(marker),
      ),
    }).toEqual({
      importers: [],
      retainedModules: [],
      settingsBarrelExportsLegacyUi: false,
    })
  })

  it('retains no legacy Badge display owner or importer', () => {
    const retainedModules = LEGACY_BADGE_DISPLAY_UI.filter(existsSync).map((path) =>
      relative(ROOT, path),
    )
    const legacyImportMarkers = [
      'StaffBadgeSummary',
      'PortalBadgeSection',
      'staff-badge-summary',
      'portal-badge-section',
    ]
    const importers = [...sourceFiles(COMPONENTS), ...sourceFiles(ROUTES)]
      .filter((path) => !LEGACY_BADGE_DISPLAY_UI.includes(path))
      .flatMap((path) => {
        const body = readFileSync(path, 'utf8')
        return legacyImportMarkers
          .filter((marker) => body.includes(marker))
          .map((marker) => `${relative(ROOT, path)}: ${marker}`)
      })

    expect({ importers, retainedModules }).toEqual({
      importers: [],
      retainedModules: [],
    })
    expect(
      readFileSync(join(ROOT, 'src', 'shared', 'queries', 'query-keys.ts'), 'utf8'),
    ).not.toContain('badgeKeys')
  })

  it('keeps retained behavior producers and consumers disconnected from beta entry points', () => {
    const legacyMarkers = [
      'registerBadgeEventHandlers',
      'evaluateBadgeForTarget',
      'reconcileBadgeDefinitions',
      'registerRecognitionEventHandlers',
      'reconcileRecognition',
      'refreshLeaderboard',
      'reconcileLeaderboards',
      'onBadgeAwarded',
      'createRecognitionLookupAdapter',
      'RecognitionLookupPort',
      'findBadgeFacts',
      'buildTeamContext',
      'createTeamRepository',
      'createTeamMembershipRepository',
    ]
    const externalEntrypoints = sourceFiles(SRC)
      .filter(
        (path) =>
          !path.startsWith(join(SRC, 'contexts', 'badge')) &&
          !path.startsWith(join(SRC, 'contexts', 'leaderboard')) &&
          !path.startsWith(join(SRC, 'contexts', 'team')),
      )
      .flatMap((path) => {
        const body = readFileSync(path, 'utf8')
        return legacyMarkers
          .filter((marker) => body.includes(marker))
          .map((marker) => `${relative(ROOT, path)}: ${marker}`)
      })

    expect(externalEntrypoints).toEqual([])
  })

  it('retains Badge notification display compatibility without an active consumer', () => {
    const removedRuntimePaths = [
      'src/contexts/notification/application/ports/recognition-lookup.port.ts',
      'src/contexts/notification/infrastructure/adapters/recognition-lookup.adapter.ts',
      'src/contexts/notification/infrastructure/event-handlers/on-badge-awarded.ts',
    ] as const
    expect(removedRuntimePaths.filter((path) => existsSync(join(ROOT, path)))).toEqual([])

    const templates = readFileSync(
      join(ROOT, 'src/contexts/notification/domain/notification-templates.ts'),
      'utf8',
    )
    const notificationTypes = readFileSync(
      join(ROOT, 'src/contexts/notification/domain/types.ts'),
      'utf8',
    )
    expect(templates).toContain("'badge.awarded': renderBadgeAwarded")
    expect(notificationTypes).toContain("'badge.awarded'")
  })
})
