import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  callsOutsideTheBuild,
  importedSpecifiers,
  modulesInTheBuild,
  serverFnCallsIn,
  journeyFilesUnder,
} from './server-fn-reachability'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('serverFnCallsIn', () => {
  test('reads the file and export name of each call a journey makes', () => {
    const source = `
      await callServerFn(page, {
        file: 'src/contexts/reporting/server/goal-programs.ts',
        exportName: 'createGoalProgram',
        data: {},
      })
      await callServerFnGet(page, {
        file: 'src/contexts/portal/server/portals.ts',
        exportName: 'getPortal',
      })`

    expect(serverFnCallsIn(source)).toEqual([
      {
        file: 'src/contexts/reporting/server/goal-programs.ts',
        exportName: 'createGoalProgram',
      },
      { file: 'src/contexts/portal/server/portals.ts', exportName: 'getPortal' },
    ])
  })

  test('reads nothing from a spec that calls no server function', () => {
    expect(serverFnCallsIn(`await page.goto('/properties')`)).toEqual([])
  })
})

describe('importedSpecifiers', () => {
  test('finds static, re-exported, side-effect and dynamic imports', () => {
    const source = `
      import { a } from './a'
      import b, {
        c,
      } from '#/b'
      export { d } from '../d'
      import './effect'
      const lazy = () => import('./lazy')
    `

    expect(importedSpecifiers(source)).toEqual([
      './a',
      '#/b',
      '../d',
      './effect',
      './lazy',
    ])
  })

  test('leaves out a type-only import, which the build erases', () => {
    const source = `
      import type { listGoalPrograms } from '#/contexts/reporting/server/goal-programs'
      export type { Thing } from './thing'
      import { real } from './real'
    `

    expect(importedSpecifiers(source)).toEqual(['./real'])
  })

  test('leaves out an import a comment only talks about', () => {
    const source = `
      // reached only by import('./lazy') from the queries module
      /* import { x } from './old' */
      import { real } from './real' // not from './elsewhere'
    `

    expect(importedSpecifiers(source)).toEqual(['./real'])
  })
})

describe('the modules in the build', () => {
  let root: string

  function write(path: string, source: string): void {
    const full = join(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, source)
  }

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'server-fn-reachability-'))
    write('src/router.tsx', `import { tree } from './routeTree.gen'`)
    write('src/routeTree.gen.ts', `import { Route } from './routes/goals'`)
    write(
      'src/routes/goals.tsx',
      `import { first } from '#/ctx/server/first'
       import type { Typed } from '#/ctx/server/typed-only'
       export const lazy = () => import('#/ctx/server/lazy')`,
    )
    write('src/ctx/server/first.ts', `import { shared } from './shared/index'`)
    write('src/ctx/server/shared/index.ts', `export const shared = 1`)
    write('src/ctx/server/lazy.ts', `export const lazy = 1`)
    write('src/ctx/server/typed-only.ts', `export type Typed = 1`)
    write('src/ctx/server/orphan.ts', `export const orphan = 1`)
    write('src/ctx/server/orphan.test.ts', `import { orphan } from './orphan'`)
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  test('holds what an entry loads by a static import, a dynamic import or an index', () => {
    const inTheBuild = modulesInTheBuild(root)

    expect(inTheBuild.has(join(root, 'src/ctx/server/first.ts'))).toBe(true)
    expect(inTheBuild.has(join(root, 'src/ctx/server/lazy.ts'))).toBe(true)
    expect(inTheBuild.has(join(root, 'src/ctx/server/shared/index.ts'))).toBe(true)
  })

  test('leaves out a module only a test, or a type-only import, names', () => {
    const inTheBuild = modulesInTheBuild(root)

    expect(inTheBuild.has(join(root, 'src/ctx/server/orphan.ts'))).toBe(false)
    expect(inTheBuild.has(join(root, 'src/ctx/server/typed-only.ts'))).toBe(false)
  })

  test('names the call whose module the build never loads', () => {
    const calls = [
      { file: 'src/ctx/server/first.ts', exportName: 'first' },
      { file: 'src/ctx/server/orphan.ts', exportName: 'orphan' },
    ]

    expect(callsOutsideTheBuild(root, calls)).toEqual([calls[1]])
  })
})

describe('the journeys of this repository', () => {
  test('call only server functions the production build carries', () => {
    const calls = journeyFilesUnder(join(REPO_ROOT, 'e2e')).flatMap((file) =>
      serverFnCallsIn(readFileSync(file, 'utf8')),
    )

    // A pattern that stopped matching would pass with nothing to check.
    expect(calls.length).toBeGreaterThan(20)
    expect(callsOutsideTheBuild(REPO_ROOT, calls)).toEqual([])
  })
})
