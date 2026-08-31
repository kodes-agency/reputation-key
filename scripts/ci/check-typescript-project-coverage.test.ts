import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  discoverTypeScriptModules,
  loadInvokedTypeScriptProjectFiles,
  validateRepositoryTypeScriptProjectCoverage,
  validateTypeScriptProjectCoverage,
} from './check-typescript-project-coverage'

const ROOT = resolve(import.meta.dirname, '../..')

describe('TypeScript project ownership', () => {
  it('owns every repository TypeScript module through an invoked project', () => {
    expect(validateRepositoryTypeScriptProjectCoverage(ROOT)).toEqual([])
  })

  it('rejects a new module that no invoked project includes', () => {
    expect(
      validateTypeScriptProjectCoverage(
        ['scripts/owned.ts', 'tools/unowned.ts'],
        ['scripts/owned.ts'],
      ),
    ).toEqual(['tools/unowned.ts is not owned by an invoked TypeScript project'])
  })

  it('uses TypeScript itself to resolve the effective project file sets', () => {
    const discovered = discoverTypeScriptModules(ROOT)
    const owned = loadInvokedTypeScriptProjectFiles(ROOT)

    expect(discovered).toContain('.storybook/preview.tsx')
    expect(discovered).toContain('drizzle.config.ts')
    expect(owned).toContain('.storybook/preview.tsx')
    expect(owned).toContain('drizzle.config.ts')
  })
})
