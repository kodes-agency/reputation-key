import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { listAllCapabilities } from '#/shared/auth/beta-capabilities'
import { CAPABILITY_FATE } from './capability-fate'
import {
  CONTEXT_STANDARDS_AUTHORITY,
  validateRequiredContextHeadings,
} from './context-standards-authority'
import {
  CONTEXT_STANDARD_DIMENSIONS,
  CONTEXT_STANDARDS_MATRIX,
} from './context-standards-matrix'

const ROOT = process.cwd()
const CONTEXT_ROOT = join(ROOT, 'src', 'contexts')

const exceptionEntry = z
  .object({
    id: z.string().regex(/^STD-(?:INV|MAINT)-\d{3}$/u),
    tier: z.enum(['invariant', 'maintainability']),
    context: z.string().trim().min(1),
    dimension: z.string().trim().min(1),
    rule: z.string().trim().min(1),
    scopes: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .refine((scope) => !/[?*{}[\]]/u.test(scope)),
      )
      .min(1),
    reason: z.string().trim().min(1),
    owner: z.string().trim().min(1),
    compensatingCheck: z.string().trim().min(1),
    sunsetTrigger: z.string().trim().min(1),
    reviewedAt: z.iso.date(),
    expiresAt: z.iso.date(),
  })
  .strict()

const exceptionRegister = z
  .object({
    version: z.literal(1),
    authority: z.literal('docs/standards.md'),
    owner: z.string().trim().min(1),
    reviewedAt: z.iso.date(),
    nextReviewAt: z.iso.date(),
    entries: z.array(exceptionEntry),
  })
  .strict()

describe('17-context standards authority', () => {
  it('matches the complete context directory and capability inventories', () => {
    const directories = readdirSync(CONTEXT_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    const governedDirectories = CONTEXT_STANDARDS_AUTHORITY.map(
      ({ directory }) => directory,
    ).sort()
    const governedCapabilities = CONTEXT_STANDARDS_AUTHORITY.flatMap(
      ({ capabilities }) => capabilities,
    ).sort()

    expect(CONTEXT_STANDARDS_AUTHORITY).toHaveLength(17)
    expect(governedDirectories).toEqual(directories)
    expect(new Set(governedCapabilities).size).toBe(governedCapabilities.length)
    expect(governedCapabilities).toEqual([...listAllCapabilities()])
    for (const capability of governedCapabilities) {
      expect(CAPABILITY_FATE[capability]).toBeDefined()
    }
  })

  it('keeps every context build, public boundary, and required document sections', () => {
    for (const row of CONTEXT_STANDARDS_AUTHORITY) {
      const directory = join(CONTEXT_ROOT, row.directory)
      const contextDocument = join(directory, 'CONTEXT.md')

      expect(existsSync(join(directory, 'build.ts')), `${row.name} build boundary`).toBe(
        true,
      )
      expect(
        existsSync(join(directory, 'application', 'public-api.ts')),
        `${row.name} public API`,
      ).toBe(true)
      expect(existsSync(contextDocument), `${row.name} context document`).toBe(true)

      const body = readFileSync(contextDocument, 'utf8')
      expect(validateRequiredContextHeadings(body), row.name).toEqual([])

      if (row.documentationMode === 'legacy') {
        expect(body).toMatch(
          /legacy[\s\S]{0,160}(?:not (?:an? )?(?:active|approved) beta|beta-dark)/iu,
        )
        for (const capability of row.capabilities) expect(body).toContain(capability)
      }
      if (row.documentationMode === 'quarantined') {
        expect(body).toMatch(/quarantin|no beta surface/iu)
        for (const capability of row.capabilities) expect(body).toContain(capability)
      }
    }
  })

  it('keeps the root bounded-context table aligned exactly once', () => {
    const rootDocument = readFileSync(join(ROOT, 'CONTEXT.md'), 'utf8')
    const rows = [...rootDocument.matchAll(/^\|\s*\|\s*([A-Za-z]+)\s*\|/gmu)]
      .map((match) => match[1])
      .filter((name) => name !== 'Context')
    const expected = CONTEXT_STANDARDS_AUTHORITY.map(({ name }) => name)

    expect(new Set(rows).size).toBe(rows.length)
    expect(rows).toHaveLength(17)
    expect(rows.sort()).toEqual(expected.sort())
  })

  it('rejects an intentionally incomplete and misordered document fixture', () => {
    const fixture = [
      '# Example',
      '## Public API',
      '## Bounded context',
      '## Events produced',
    ].join('\n')

    expect(validateRequiredContextHeadings(fixture)).toEqual([
      'missing heading: ## Invariants',
      'required headings are out of order',
    ])
  })
})

describe('standards exception register', () => {
  it('is owned, review-bounded, narrowly scoped, and has no duplicate ids', () => {
    const register = exceptionRegister.parse(
      JSON.parse(
        readFileSync(
          join(ROOT, 'docs', 'governance', 'standards-exceptions.json'),
          'utf8',
        ),
      ),
    )

    expect(register.nextReviewAt > register.reviewedAt).toBe(true)
    expect(new Set(register.entries.map(({ id }) => id)).size).toBe(
      register.entries.length,
    )
    const contextDirectories = new Set<string>(
      CONTEXT_STANDARDS_AUTHORITY.map(({ directory }) => directory),
    )
    const dimensions = new Set<string>(CONTEXT_STANDARD_DIMENSIONS.map(({ id }) => id))
    const today = new Date().toISOString().slice(0, 10)
    for (const entry of register.entries) {
      expect(entry.expiresAt > entry.reviewedAt, entry.id).toBe(true)
      expect(entry.expiresAt >= today, entry.id).toBe(true)
      expect(contextDirectories.has(entry.context), entry.id).toBe(true)
      expect(dimensions.has(entry.dimension), entry.id).toBe(true)
      expect(
        entry.scopes.some(
          (scope) =>
            scope === `src/contexts/${entry.context}` ||
            scope.startsWith(`src/contexts/${entry.context}/`),
        ),
        `${entry.id}: missing context-owned scope`,
      ).toBe(true)
      for (const scope of entry.scopes) {
        expect(existsSync(join(ROOT, scope)), `${entry.id}: ${scope}`).toBe(true)
      }
    }

    const registeredExceptionCells = register.entries.map(
      ({ id, context, dimension }) => `${id}:${context}/${dimension}`,
    )
    const matrixExceptionCells = CONTEXT_STANDARDS_MATRIX.flatMap((row) =>
      CONTEXT_STANDARD_DIMENSIONS.flatMap(({ id: dimension }) => {
        const cell = row.standards[dimension]
        return cell.applicability === 'applicable' &&
          cell.resolution === 'accepted_exception'
          ? [`${cell.exceptionId}:${row.directory}/${dimension}`]
          : []
      }),
    )
    expect(registeredExceptionCells.sort()).toEqual(matrixExceptionCells.sort())
  })

  it('rejects a broad or unowned negative fixture', () => {
    const invalid = {
      version: 1,
      authority: 'docs/standards.md',
      owner: 'Architecture',
      reviewedAt: '2026-08-26',
      nextReviewAt: '2026-09-30',
      entries: [
        {
          id: 'STD-INV-001',
          tier: 'invariant',
          context: 'example',
          dimension: 'errors',
          rule: 'example',
          scopes: ['src/**'],
          reason: 'fixture',
          owner: '',
          compensatingCheck: 'fixture',
          sunsetTrigger: 'fixture',
          reviewedAt: '2026-08-26',
          expiresAt: '2026-09-30',
        },
      ],
    }

    expect(exceptionRegister.safeParse(invalid).success).toBe(false)
  })
})
