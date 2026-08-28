import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LEGACY_INFRASTRUCTURE_FUNCTION_FACTORIES,
  staleInfrastructureFunctionFactoryAllowances,
  unapprovedInfrastructureFunctionFactories,
} from './infrastructure-factory-style-authority'

const ROOT = process.cwd()
const CONTEXTS_ROOT = join(ROOT, 'src', 'contexts')

function productionTypescriptFiles(directory: string): readonly string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return productionTypescriptFiles(path)
    return entry.name.endsWith('.ts') && !entry.name.includes('.test.') ? [path] : []
  })
}

function currentFunctionFactories(): readonly string[] {
  return readdirSync(CONTEXTS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) =>
      productionTypescriptFiles(join(CONTEXTS_ROOT, entry.name, 'infrastructure')),
    )
    .flatMap((path) => {
      const source = readFileSync(path, 'utf8')
      const repositoryPath = relative(ROOT, path).split(sep).join('/')
      return [
        ...source.matchAll(/^export\s+(?:async\s+)?function\s+(create[A-Za-z0-9_]*)/gmu),
      ].map((match) => `${repositoryPath}#${match[1]}`)
    })
    .sort()
}

describe('infrastructure factory declaration authority', () => {
  it('allows only the exact shrinking legacy function-factory inventory', () => {
    const current = currentFunctionFactories()

    expect(new Set(LEGACY_INFRASTRUCTURE_FUNCTION_FACTORIES).size).toBe(
      LEGACY_INFRASTRUCTURE_FUNCTION_FACTORIES.length,
    )
    expect(unapprovedInfrastructureFunctionFactories(current)).toEqual([])
    expect(staleInfrastructureFunctionFactoryAllowances(current)).toEqual([])
  })

  it('rejects a new export-function factory independently of the live inventory', () => {
    expect(
      unapprovedInfrastructureFunctionFactories([
        ...currentFunctionFactories(),
        'src/contexts/portal/infrastructure/new-store.ts#createNewStore',
      ]),
    ).toEqual(['src/contexts/portal/infrastructure/new-store.ts#createNewStore'])
  })
})
