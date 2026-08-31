import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const LEGACY_GOAL_UI = join(ROOT, 'src', 'components', 'features', 'property', 'goals')
const SUPPORTED_GOAL_UI = join(ROOT, 'src', 'components', 'goals')
const OBSOLETE_GOAL_UI_HELPERS = [
  join(ROOT, 'src', 'contexts', 'goal', 'ui', 'helpers.ts'),
  join(ROOT, 'src', 'contexts', 'goal', 'ui', 'helpers.test.ts'),
] as const
const OBSOLETE_DELETE_DIALOG = join(
  ROOT,
  'src',
  'components',
  'features',
  'property',
  'delete-property-dialog.tsx',
)

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) return []
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) return []
    if (entry.name.endsWith('.stories.ts') || entry.name.endsWith('.stories.tsx'))
      return []
    return [path]
  })
}

describe('legacy policy UI stays out of active beta surfaces', () => {
  it('has one supported Goal presentation owner and no legacy presentation mirror', () => {
    const legacyModules = existsSync(LEGACY_GOAL_UI)
      ? sourceFiles(LEGACY_GOAL_UI).map((path) => relative(ROOT, path))
      : []
    const legacyImporters = sourceFiles(SRC)
      .filter((path) => !path.startsWith(LEGACY_GOAL_UI))
      .filter((path) =>
        readFileSync(path, 'utf8').includes('#/components/features/property/goals/'),
      )
      .map((path) => relative(ROOT, path))

    expect(existsSync(SUPPORTED_GOAL_UI)).toBe(true)
    expect({ legacyImporters, legacyModules }).toEqual({
      legacyImporters: [],
      legacyModules: [],
    })
    expect(OBSOLETE_GOAL_UI_HELPERS.filter(existsSync)).toEqual([])
  })

  it('keeps the superseded destructive property dialog absent', () => {
    expect(existsSync(OBSOLETE_DELETE_DIALOG)).toBe(false)
  })

  it('keeps the active notification bell on the NotificationPanel owner', () => {
    const panel = readFileSync(
      join(
        ROOT,
        'src',
        'components',
        'features',
        'notification',
        'notification-panel.tsx',
      ),
      'utf8',
    )
    const appTopBar = readFileSync(
      join(ROOT, 'src', 'components', 'layout', 'app-top-bar.tsx'),
      'utf8',
    )

    expect(panel).toContain('export function NotificationPanel')
    expect(appTopBar).toContain('NotificationPanel')
  })
})
