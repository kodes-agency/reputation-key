import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  renderSharedBoundaryPolicies,
  SHARED_BOUNDARY_POLICY_MARKERS,
  SHARED_DEPENDENCY_POLICY,
} from './shared-dependency-policy'

const ROOT = resolve(import.meta.dirname, '../../..')
const SHARED_ROOT = resolve(ROOT, 'src/shared')
const SHARED_CONTEXT = resolve(SHARED_ROOT, 'CONTEXT.md')
const ESLINT_CONFIG = resolve(ROOT, 'eslint.config.js')

const AREA_TABLE_START = '<!-- shared-first-level-ownership:start -->'
const AREA_TABLE_END = '<!-- shared-first-level-ownership:end -->'
const ROOT_TABLE_START = '<!-- shared-root-category-ownership:start -->'
const ROOT_TABLE_END = '<!-- shared-root-category-ownership:end -->'

type OwnershipRow = Readonly<{
  key: string
  purpose: string
  ownershipRule: string
  /** Only the first-level area table carries a 4th column (ARC-03-T3). */
  permittedDependencies?: readonly string[]
}>

function ownershipRowsBetween(start: string, end: string): readonly OwnershipRow[] {
  const document = readFileSync(SHARED_CONTEXT, 'utf8')
  const startIndex = document.indexOf(start)
  const endIndex = document.indexOf(end)
  if (startIndex < 0 || endIndex <= startIndex) {
    throw new Error(`Shared ownership table is missing ${start} / ${end}`)
  }

  const tableLines = document
    .slice(startIndex + start.length, endIndex)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'))
  if (tableLines.length < 3) {
    throw new Error(`Shared ownership table ${start} has no data rows`)
  }
  const headers = tableLines[0]!
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim())
  if (headers[1] !== 'Purpose' || headers[2] !== 'Owner and placement rule') {
    throw new Error(`Shared ownership table ${start} must name purpose and owner`)
  }
  // ARC-03-T3: the area table also declares the permitted-dependency graph.
  const columns = headers[3] === 'Permitted dependencies' ? 4 : 3
  if (start === AREA_TABLE_START && columns !== 4) {
    throw new Error('Shared area table must declare Permitted dependencies')
  }

  return tableLines.slice(2).map((line) => {
    const cells = line
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim().replaceAll('`', ''))
    if (cells.length !== columns || cells.some((cell) => cell.length === 0)) {
      throw new Error(`Shared ownership row is incomplete: ${line}`)
    }
    return {
      key: cells[0]!,
      purpose: cells[1]!,
      ownershipRule: cells[2]!,
      ...(columns === 4
        ? { permittedDependencies: cells[3]!.split(',').map((entry) => entry.trim()) }
        : {}),
    }
  })
}

function currentFirstLevelAreas(): readonly string[] {
  return readdirSync(SHARED_ROOT, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        readdirSync(resolve(SHARED_ROOT, entry.name), { withFileTypes: true }).length > 0,
    )
    .map((entry) => entry.name)
    .sort()
}

function currentRootProductionFiles(): readonly string[] {
  return readdirSync(SHARED_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name !== 'CONTEXT.md' && !name.startsWith('.'))
    .filter((name) => !/\.(?:integration\.test|stories|test)\.(?:ts|tsx)$/u.test(name))
    .sort()
}

function matchesDocumentedPattern(file: string, pattern: string): boolean {
  if (!pattern.includes('*')) return file === pattern
  if (!pattern.endsWith('*') || pattern.indexOf('*') !== pattern.length - 1) {
    throw new Error(`Shared root pattern must be exact or a prefix glob: ${pattern}`)
  }
  const prefix = pattern.slice(0, -1)
  if (prefix.length < 3 || !prefix.endsWith('-')) {
    throw new Error(`Shared root prefix glob must name a specific category: ${pattern}`)
  }
  return file.startsWith(prefix)
}

function ownershipViolations(
  actualKeys: readonly string[],
  rows: readonly OwnershipRow[],
  matches: (actualKey: string, documentedKey: string) => boolean,
): readonly Readonly<{ actualKey: string; documentedKeys: readonly string[] }>[] {
  return actualKeys
    .map((actualKey) => ({
      actualKey,
      documentedKeys: rows
        .filter(({ key }) => matches(actualKey, key))
        .map(({ key }) => key),
    }))
    .filter(({ documentedKeys }) => documentedKeys.length !== 1)
}

describe('shared context ownership documentation', () => {
  it('documents every current first-level production area with a purpose and owner', () => {
    const rows = ownershipRowsBetween(AREA_TABLE_START, AREA_TABLE_END)

    expect(rows.map(({ key }) => key).sort()).toEqual(currentFirstLevelAreas())
    expect(rows.every(({ purpose }) => purpose.length >= 20)).toBe(true)
    expect(rows.every(({ ownershipRule }) => ownershipRule.length >= 20)).toBe(true)
  })

  it('assigns every root production file to exactly one documented category', () => {
    const rows = ownershipRowsBetween(ROOT_TABLE_START, ROOT_TABLE_END)
    const files = currentRootProductionFiles()

    expect(ownershipViolations(files, rows, matchesDocumentedPattern)).toEqual([])
    expect(
      rows.filter(
        ({ key }) => !files.some((file) => matchesDocumentedPattern(file, key)),
      ),
    ).toEqual([])
    expect(rows.every(({ purpose }) => purpose.length >= 20)).toBe(true)
    expect(rows.every(({ ownershipRule }) => ownershipRule.length >= 20)).toBe(true)
  })

  it('documents the permitted-dependency graph exactly as the policy declares it', () => {
    const documented = ownershipRowsBetween(AREA_TABLE_START, AREA_TABLE_END).map(
      ({ key, permittedDependencies }) => ({ area: key, allows: permittedDependencies }),
    )
    const declared = SHARED_DEPENDENCY_POLICY.map(({ area, allows }) => ({
      area,
      allows: [...allows],
    }))

    // Both directions: the table may not add an area the policy omits, and the
    // policy may not add an edge the table never disclosed to its owner.
    expect(documented).toEqual(declared)
    expect(declared).toEqual(documented)
  })

  it('keeps the linter byte-identical to the declared policy', () => {
    // eslint.config.js cannot import a TypeScript module, so the derived
    // policies are pasted into it. This is what stops the paste from drifting:
    // the generated text must appear verbatim between the markers.
    const config = readFileSync(ESLINT_CONFIG, 'utf8')
    const { start, end } = SHARED_BOUNDARY_POLICY_MARKERS
    const startIndex = config.indexOf(start)
    const endIndex = config.indexOf(end)
    expect(startIndex, 'policy start marker').toBeGreaterThan(-1)
    expect(endIndex, 'policy end marker').toBeGreaterThan(startIndex)

    const indent = startIndex - (config.lastIndexOf('\n', startIndex) + 1)
    const inConfig = config.slice(startIndex - indent, endIndex + end.length + 1)
    expect(inConfig).toBe(renderSharedBoundaryPolicies(indent))
  })

  it('rejects a future undocumented area and root production category', () => {
    const areaRows = ownershipRowsBetween(AREA_TABLE_START, AREA_TABLE_END)
    const rootRows = ownershipRowsBetween(ROOT_TABLE_START, ROOT_TABLE_END)

    expect(
      ownershipViolations(
        ['future-undocumented-area'],
        areaRows,
        (area, documentedArea) => area === documentedArea,
      ),
    ).toEqual([{ actualKey: 'future-undocumented-area', documentedKeys: [] }])
    expect(
      ownershipViolations(
        ['future-undocumented-contract.ts'],
        rootRows,
        matchesDocumentedPattern,
      ),
    ).toEqual([
      {
        actualKey: 'future-undocumented-contract.ts',
        documentedKeys: [],
      },
    ])
    expect(() => matchesDocumentedPattern('anything.ts', '*')).toThrow(
      'Shared root prefix glob must name a specific category',
    )
  })
})
