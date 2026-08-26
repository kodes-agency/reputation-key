import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
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
})
