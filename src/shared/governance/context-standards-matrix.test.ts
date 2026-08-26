import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CONTEXT_STANDARDS_AUTHORITY,
  validateRequiredContextHeadings,
} from './context-standards-authority'
import {
  CONTEXT_STANDARD_DIMENSIONS,
  CONTEXT_STANDARDS_MATRIX,
  summarizeContextStandardsMatrix,
  validateContextStandardsMatrixStructure,
} from './context-standards-matrix'

const ROOT = process.cwd()
const DIMENSIONS = [
  'tags',
  'envelope',
  'assert',
  'union',
  'triple',
  'errors',
  'build',
  'docs',
  'repositories',
  'files',
  'factories',
] as const

function productionTypescriptFiles(directory: string): readonly string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return productionTypescriptFiles(path)
    return entry.name.endsWith('.ts') && !entry.name.includes('.test.') ? [path] : []
  })
}

function eventsSection(body: string): string {
  return body.split('## Events produced')[1]?.split(/^## /mu)[0] ?? ''
}

describe('17-context by 11-rule standards matrix', () => {
  it('has the exact authority rows, dimensions, and conservative outcomes', () => {
    expect(CONTEXT_STANDARD_DIMENSIONS.map(({ id }) => id)).toEqual(DIMENSIONS)
    expect(CONTEXT_STANDARDS_MATRIX.map(({ directory }) => directory)).toEqual(
      CONTEXT_STANDARDS_AUTHORITY.map(({ directory }) => directory),
    )
    for (const row of CONTEXT_STANDARDS_MATRIX) {
      expect(Object.keys(row.standards), row.directory).toEqual(DIMENSIONS)
    }
    expect(
      validateContextStandardsMatrixStructure(
        CONTEXT_STANDARDS_MATRIX,
        CONTEXT_STANDARDS_AUTHORITY.map(({ directory }) => directory),
      ),
    ).toEqual([])
    expect(summarizeContextStandardsMatrix(CONTEXT_STANDARDS_MATRIX)).toEqual({
      evidenced: 53,
      notApplicable: 17,
      unresolved: 117,
      total: 187,
    })
  })

  it('keeps every evidence pointer executable against the current tree', () => {
    for (const row of CONTEXT_STANDARDS_MATRIX) {
      for (const dimension of DIMENSIONS) {
        for (const evidence of row.standards[dimension].evidence) {
          expect(evidence.path.startsWith('/') || evidence.path.includes('..')).toBe(
            false,
          )
          const path = join(ROOT, evidence.path)
          if (evidence.kind === 'absent') {
            expect(
              existsSync(path),
              `${row.directory}/${dimension}: ${evidence.path}`,
            ).toBe(false)
            continue
          }
          expect(
            existsSync(path),
            `${row.directory}/${dimension}: ${evidence.path}`,
          ).toBe(true)
          expect(statSync(path).isFile(), evidence.path).toBe(evidence.kind === 'file')
          if (evidence.kind === 'file') {
            const body = readFileSync(path, 'utf8')
            for (const marker of evidence.contains ?? []) expect(body).toContain(marker)
          }
        }
      }
    }
  })

  it('proves the narrow event tag and union claims without blessing other rules', () => {
    const masterUnion = readFileSync(join(ROOT, 'src/shared/events/events.ts'), 'utf8')
    for (const row of CONTEXT_STANDARDS_MATRIX) {
      const tagsCell = row.standards.tags
      if (tagsCell.applicability === 'not_applicable') continue
      const eventSource = readFileSync(
        join(ROOT, `src/contexts/${row.directory}/domain/events.ts`),
        'utf8',
      )
      const tags = [...eventSource.matchAll(/_tag:\s*'([^']+)'/gu)].map(
        (match) => match[1]!,
      )
      const tagPattern = new RegExp(
        `^${row.directory}\\.[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)?$`,
        'u',
      )
      expect(tags.length, row.directory).toBeGreaterThan(0)
      if (tagsCell.resolution === 'evidenced') {
        expect(
          tags.every((tag) => tagPattern.test(tag)),
          row.directory,
        ).toBe(true)
      } else if (row.directory === 'portal') {
        expect(tags.some((tag) => !tagPattern.test(tag))).toBe(true)
      }

      const eventType = row.name === 'AI' ? 'AiEvent' : `${row.name}Event`
      expect(eventSource).toContain(`export type ${eventType}`)
      expect(masterUnion).toContain(`| ${eventType}`)
      expect(row.standards.union.resolution).toBe('evidenced')
    }
  })

  it('checks the evidenced build, documentation, and factory claims', () => {
    for (const row of CONTEXT_STANDARDS_MATRIX) {
      const contextRoot = join(ROOT, 'src', 'contexts', row.directory)
      const buildSource = readFileSync(join(contextRoot, 'build.ts'), 'utf8')
      if (row.standards.build.resolution === 'evidenced') {
        expect(buildSource, row.directory).toMatch(/\bpublicApi\b/u)
        expect(buildSource, row.directory).toMatch(/\binternal\s*:/u)
        expect(buildSource, row.directory).toMatch(/\brepos\s*:/u)
        expect(buildSource, row.directory).toMatch(/\buseCases\b/u)
      }

      const document = readFileSync(join(contextRoot, 'CONTEXT.md'), 'utf8')
      expect(validateRequiredContextHeadings(document), row.directory).toEqual([])
      const section = eventsSection(document)
      if (row.standards.docs.resolution === 'evidenced') {
        expect(
          /^\|/mu.test(section) ||
            /(?:no .*domain events|does not emit domain events)/iu.test(section),
          row.directory,
        ).toBe(true)
      }

      const legacyFactories = productionTypescriptFiles(
        join(contextRoot, 'infrastructure'),
      ).filter((path) =>
        /^export\s+(?:async\s+)?function\s+create/mu.test(readFileSync(path, 'utf8')),
      )
      if (row.standards.factories.resolution === 'evidenced') {
        expect(legacyFactories, row.directory).toEqual([])
      } else {
        expect(legacyFactories.length, row.directory).toBeGreaterThan(0)
      }
    }
  })

  it('rejects an incomplete matrix fixture independently of the catalogue', () => {
    const incomplete = [{ ...CONTEXT_STANDARDS_MATRIX[0], standards: {} }]
    const issues = validateContextStandardsMatrixStructure(incomplete, ['activity'])

    expect(issues).toHaveLength(11)
    expect(issues[0]).toBe('activity: missing dimension tags')
    expect(issues.at(-1)).toBe('activity: missing dimension factories')
  })
})
