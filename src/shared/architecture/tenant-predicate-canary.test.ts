import { readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { getTableColumns, getTableName, isTable } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as schema from '#/shared/db/schema'
import { DATA_FATE_AUTHORITY } from '#/shared/governance/data-fate-authority'
import { walk } from '#/shared/testing/source-tree'
import {
  type CallableReport,
  type SourceText,
  type TenantTables,
  inspectTenantStatements,
} from './tenant-predicate-constraint'
import {
  type TenantPredicateExemption,
  TENANT_PREDICATE_EXEMPTIONS,
} from './tenant-predicate-exemptions'

const ROOT = process.cwd()
const CONTEXTS_ROOT = join(ROOT, 'src', 'contexts')
const SYNTHETIC = 'synthetic.repository.ts'

function hasOrganizationColumn(table: Parameters<typeof getTableColumns>[0]): boolean {
  return Object.values(getTableColumns(table)).some(
    (column) => column.name === 'organization_id',
  )
}

/**
 * Every table with an `organization_id` column is tenant-owned unless the
 * data-fate authority gives it to Identity or the platform, whose tables are
 * outside this canary. A table the authority does not list is still held.
 */
function tenantTables(): TenantTables {
  const outsideCanary = new Set(
    DATA_FATE_AUTHORITY.filter(
      (row) => row.owner === 'identity' || row.owner === 'platform',
    ).map((row) => row.exportName),
  )
  const allExportNames = new Set<string>()
  const tenantExportNames = new Set<string>()
  const tenantDatabaseNames = new Set<string>()

  for (const [exportName, value] of Object.entries(schema)) {
    if (!isTable(value)) continue
    allExportNames.add(exportName)
    if (outsideCanary.has(exportName) || !hasOrganizationColumn(value)) continue
    tenantExportNames.add(exportName)
    tenantDatabaseNames.add(getTableName(value))
  }

  return { allExportNames, tenantExportNames, tenantDatabaseNames }
}

/** A callable is tenant-free when it queries a tenant-owned table and no statement of it is restricted. */
function isTenantFree(report: CallableReport): boolean {
  return report.tenantStatements > 0 && report.restrictedStatements === 0
}

function inspectSynthetic(text: string): readonly CallableReport[] {
  return (
    inspectTenantStatements([{ file: SYNTHETIC, text }], tenantTables()).get(SYNTHETIC) ??
    []
  )
}

function tenantFreeSymbols(text: string): readonly string[] {
  return inspectSynthetic(text)
    .filter(isTenantFree)
    .map((report) => report.symbol)
}

function infrastructureSources(): readonly SourceText[] {
  return walk(CONTEXTS_ROOT)
    .filter(
      (file) =>
        file.includes(`${sep}infrastructure${sep}`) &&
        file.endsWith('.ts') &&
        !file.endsWith('.test.ts') &&
        !file.endsWith('.d.ts'),
    )
    .sort()
    .map((absoluteFile) => ({
      file: relative(ROOT, absoluteFile).split(sep).join('/'),
      text: readFileSync(absoluteFile, 'utf8'),
    }))
}

function exemptionKey(entry: TenantPredicateExemption): string {
  return `${entry.file}#${entry.symbol}`
}

/** What a category asserts about its callable beyond "no tenant value restricts it". */
const CATEGORY_CLAIMS: Readonly<
  Partial<
    Record<TenantPredicateExemption['category'], (report: CallableReport) => boolean>
  >
> = {
  'TENANT-CHECKED': (report) => report.comparesTenantValues,
  'TENANT-CORRELATED': (report) => report.tiesTenantColumns,
  'OWNER-LOOKUP': (report) => report.mentionsTenant,
}

describe('canary: every tenant-owned repository query carries a tenant predicate (S12)', () => {
  it('flags a synthetic unscoped tenant-owned query', () => {
    const tables = tenantTables()
    expect(tables.tenantExportNames.has('reviews')).toBe(true)

    expect(
      tenantFreeSymbols(
        `const findReview = async (reviewId: string) =>
          db.select().from(reviews).where(eq(reviews.id, reviewId))`,
      ),
    ).toEqual(['findReview'])
  })

  // R1A-01: a mention of the tenant is not a predicate. Each source names
  // `organizationId` and restricts no statement to a tenant value.
  it.each([
    [
      'a projection key',
      `const findReply = async (replyId: string) =>
        db.select({ id: replies.id, organizationId: replies.organizationId })
          .from(replies).where(eq(replies.id, replyId))`,
    ],
    [
      'a row mapper',
      `const findReply = async (replyId: string) => {
        const rows = await db.select().from(replies).where(eq(replies.id, replyId))
        return rows.map((row) => ({ id: row.id, organizationId: row.organizationId }))
      }`,
    ],
    [
      'an unused parameter',
      `const findReply = async (organizationId: string, replyId: string) =>
        db.select().from(replies).where(eq(replies.id, replyId))`,
    ],
    [
      'a tenant column tied to another tenant column',
      `const findReply = async (replyId: string) =>
        db.select().from(replies)
          .innerJoin(reviews, eq(reviews.id, replies.reviewId))
          .where(and(
            eq(replies.id, replyId),
            eq(reviews.organizationId, replies.organizationId),
          ))`,
    ],
    [
      'a keyset cursor',
      `const findReply = async (cursor: { organizationId: string; id: string }) =>
        db.select().from(replies).where(or(
          gt(replies.organizationId, cursor.organizationId),
          and(
            eq(replies.organizationId, cursor.organizationId),
            gt(replies.id, cursor.id),
          ),
        ))`,
    ],
    [
      'a raw row-value cursor',
      `const findReply = async (cursor: { organizationId: string; id: string }) =>
        db.execute(sql\`
          SELECT id FROM replies
          WHERE (organization_id, id) > (\${cursor.organizationId}, \${cursor.id})
          ORDER BY organization_id, id\`)`,
    ],
    [
      'a predicate added only inside an if',
      `const findReply = async (replyId: string, orgId?: string) => {
        const conditions = [eq(replies.id, replyId)]
        if (orgId) conditions.push(eq(replies.organizationId, orgId))
        return db.select().from(replies).where(and(...conditions))
      }`,
    ],
    [
      'an optional predicate',
      `const findReply = async (replyId: string, orgId?: string) =>
        db.select().from(replies).where(and(
          eq(replies.id, replyId),
          orgId === undefined ? undefined : eq(replies.organizationId, orgId),
        ))`,
    ],
    [
      'a row that was read under the tenant',
      `const findReply = async (orgId: string, reviewId: string) => {
        const review = await loadReview(orgId, reviewId)
        return db.select().from(replies).where(eq(replies.reviewId, review.id))
      }`,
    ],
    [
      'a correlated raw fragment',
      `const findReply = () => sql\`EXISTS (
        SELECT 1 FROM replies AS reply
        WHERE reply.organization_id = review.organization_id
          AND reply.review_id = review.id)\``,
    ],
  ])('flags a tenant-free query whose only tenant mention is %s', (_mention, source) => {
    expect(tenantFreeSymbols(source)).toEqual(['findReply'])
  })

  it.each([
    [
      'in the where clause',
      `const findReply = async (orgId: string, replyId: string) =>
        db.select().from(replies)
          .where(and(eq(replies.organizationId, orgId), eq(replies.id, replyId)))`,
    ],
    [
      'in a condition list built before the query',
      `const findReply = async (orgId: string, replyId?: string) => {
        const conditions = [eq(replies.organizationId, orgId)]
        if (replyId) conditions.push(eq(replies.id, replyId))
        return db.select().from(replies).where(and(...conditions))
      }`,
    ],
    [
      'handed to the shared tenant helper',
      `const findReply = async (orgId: string, replyId: string) =>
        db.select().from(replies)
          .where(and(...baseWhere(replies, orgId), eq(replies.id, replyId)))`,
    ],
    [
      'in a helper of the same file',
      `const scoped = (ctx: { organizationId: string }) =>
        eq(replies.organizationId, ctx.organizationId)
      const findReply = async (ctx: { organizationId: string }, replyId: string) =>
        db.select().from(replies).where(and(scoped(ctx), eq(replies.id, replyId)))`,
    ],
    [
      'bound to the tenant column of a raw statement',
      `const findReply = async (tenant: string, replyId: string) =>
        db.execute(sql\`
          SELECT id FROM replies
          WHERE organization_id = \${tenant} AND id = \${replyId}\`)`,
    ],
    [
      'compared null-safely',
      `const findReply = async (input: { organizationId: string | null; id: string }) =>
        db.select().from(replies).where(and(
          eq(replies.id, input.id),
          input.organizationId === null
            ? isNull(replies.organizationId)
            : eq(replies.organizationId, input.organizationId),
        ))`,
    ],
    [
      'folded into the key the row is found by',
      `const findReply = async (orgId: string, requestId: string) => {
        const key = receiptKey(orgId, requestId)
        return db.select().from(replies).where(eq(replies.idempotencyKey, key))
      }`,
    ],
    [
      'equal to a value under another name',
      `const findReply = async (owner: { id: string }, replyId: string) =>
        db.select().from(replies)
          .where(and(eq(replies.organizationId, owner.id), eq(replies.id, replyId)))`,
    ],
  ])('accepts a query whose tenant value is %s', (_position, source) => {
    const reports = inspectSynthetic(source).filter(
      (report) => report.symbol === 'findReply',
    )

    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ tenantStatements: 1, restrictedStatements: 1 })
  })

  it('holds a predicate parameter to every caller in the file', () => {
    const countWhere = `const countWhere = async (where: SQL) =>
      db.select().from(replies).where(where)
    const countForOrganization = (orgId: string) =>
      countWhere(eq(replies.organizationId, orgId))`

    expect(tenantFreeSymbols(countWhere)).toEqual([])
    expect(
      tenantFreeSymbols(
        `${countWhere}
        const countEverywhere = () => countWhere(isNotNull(replies.id))`,
      ),
    ).toEqual(['countWhere'])
    expect(
      tenantFreeSymbols(
        `const countWhere = async (where: SQL) => db.select().from(replies).where(where)`,
      ),
    ).toEqual(['countWhere'])
  })

  it('holds an exported predicate parameter to the files that import it', () => {
    const tables = tenantTables()
    const facade: SourceText = {
      file: 'read-facade.ts',
      text: `export const readReplies = async (scope: SQL | undefined) =>
        db.select().from(replies).where(and(scope, isNotNull(replies.publishedAt)))`,
    }
    const tenantFree = (caller: string): readonly string[] =>
      (
        inspectTenantStatements(
          [facade, { file: 'adapter.ts', text: caller }],
          tables,
        ).get(facade.file) ?? []
      )
        .filter(isTenantFree)
        .map((report) => report.symbol)

    expect(
      tenantFree(`import { readReplies } from './read-facade'
        const forOrganization = (orgId: string) =>
          readReplies(eq(replies.organizationId, orgId))`),
    ).toEqual([])
    expect(
      tenantFree(`import { readReplies } from './read-facade'
        const everywhere = () => readReplies(undefined)`),
    ).toEqual(['readReplies'])
  })

  it('judges only the statements that name a tenant-owned table', () => {
    const tables = tenantTables()
    expect(tables.allExportNames.has('organizationExports')).toBe(true)
    expect(tables.tenantExportNames.has('organizationExports')).toBe(false)
    expect(tables.tenantExportNames.has('auditLogs')).toBe(true)

    // The where clause is on a table outside the canary's authority; the
    // tenant-owned table is only inserted into, with its Organization.
    const reports = inspectSynthetic(
      `const completeExport = async (exportId: string, organization: string) => {
        await db.update(organizationExports).set({ state: 'ready' })
          .where(eq(organizationExports.id, exportId))
        await db.insert(auditLogs).values({ organizationId: organization })
      }`,
    )

    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ symbol: 'completeExport', tenantStatements: 0 })
  })

  it('holds the goal month target log to the tenant predicate', () => {
    expect(tenantTables().tenantExportNames.has('goalMonthTargetChanges')).toBe(true)

    // A Program id alone is not a tenant predicate: the log is keyed by
    // organization, Property and Program together.
    expect(
      tenantFreeSymbols(
        `const listTargetChanges = async (programId: string) =>
          db.select().from(goalMonthTargetChanges)
            .where(eq(goalMonthTargetChanges.programId, programId))`,
      ),
    ).toEqual(['listTargetChanges'])
  })

  // What the registry says the canary checks by machine for three categories.
  it('reports whether a callable compares two tenant values (TENANT-CHECKED)', () => {
    const loadReply = (afterRead: string): string =>
      `const loadReply = async (input: { organizationId: string; id: string }) => {
        const rows = await db.select().from(replies).where(eq(replies.id, input.id))
        const row = rows[0]
        ${afterRead}
      }`

    expect(inspectSynthetic(loadReply('return row ?? null'))).toEqual([
      expect.objectContaining({ restrictedStatements: 0, comparesTenantValues: false }),
    ])
    // Comparing the row's tenant with anything but a tenant value proves nothing.
    expect(
      inspectSynthetic(loadReply('return row?.organizationId === null ? null : row')),
    ).toEqual([
      expect.objectContaining({ restrictedStatements: 0, comparesTenantValues: false }),
    ])
    expect(
      inspectSynthetic(
        loadReply('return row?.organizationId === input.organizationId ? row : null'),
      ),
    ).toEqual([
      expect.objectContaining({ restrictedStatements: 0, comparesTenantValues: true }),
    ])
  })

  it.each([
    [
      'a raw fragment',
      (predicate: string) =>
        `const hasReply = () => sql\`EXISTS (
          SELECT 1 FROM replies AS reply WHERE ${predicate})\``,
      'reply.organization_id = review.organization_id AND reply.review_id = review.id',
      'reply.review_id = review.id',
    ],
    [
      'a subquery',
      (predicate: string) =>
        `const hasReply = () => db.select().from(replies).where(${predicate})`,
      'eq(replies.organizationId, reviews.organizationId)',
      'eq(replies.reviewId, reviews.id)',
    ],
  ])(
    'reports whether %s ties two rows on the tenant column (TENANT-CORRELATED)',
    (_form, source, tie, noTie) => {
      expect(inspectSynthetic(source(tie))).toEqual([
        expect.objectContaining({ restrictedStatements: 0, tiesTenantColumns: true }),
      ])
      expect(inspectSynthetic(source(noTie))).toEqual([
        expect.objectContaining({ restrictedStatements: 0, tiesTenantColumns: false }),
      ])
    },
  )

  it('reports whether a lookup names the tenant column (OWNER-LOOKUP)', () => {
    const resolveReply = (projection: string): string =>
      `const resolveReply = async (replyId: string) =>
        db.select({ ${projection} }).from(replies).where(eq(replies.id, replyId))`

    expect(
      inspectSynthetic(resolveReply('organizationId: replies.organizationId')),
    ).toEqual([
      expect.objectContaining({ restrictedStatements: 0, mentionsTenant: true }),
    ])
    expect(inspectSynthetic(resolveReply('propertyId: replies.propertyId'))).toEqual([
      expect.objectContaining({ restrictedStatements: 0, mentionsTenant: false }),
    ])
  })

  it('matches every detected tenant-free query exactly to the reviewed registry', () => {
    const reports = inspectTenantStatements(infrastructureSources(), tenantTables())
    const tenantFree = new Set(
      [...reports].flatMap(([file, callables]) =>
        callables.filter(isTenantFree).map((report) => `${file}#${report.symbol}`),
      ),
    )
    const registered = new Set(TENANT_PREDICATE_EXEMPTIONS.map(exemptionKey))

    expect(
      TENANT_PREDICATE_EXEMPTIONS.filter(
        (entry) => entry.category === 'UNSCOPED-PENDING',
      ),
    ).toHaveLength(0)
    expect(tenantFree.size).toBeGreaterThan(0)
    expect({
      // A tenant-free query nobody reviewed: restrict it, or register it with its reason.
      unregistered: [...tenantFree].filter((key) => !registered.has(key)).sort(),
      // A registered query that is now restricted, or no longer queries a tenant-owned table.
      stale: [...registered].filter((key) => !tenantFree.has(key)).sort(),
    }).toEqual({ unregistered: [], stale: [] })
  })

  it('keeps every exemption unique, explained, and attached to a real callable', () => {
    const reports = inspectTenantStatements(infrastructureSources(), tenantTables())
    const seen = new Set<string>()
    const duplicateEntries: string[] = []
    const shortReasons: string[] = []
    const invalidPendingReasons: string[] = []
    const staleEntries: string[] = []
    const unprovenClaims: string[] = []

    for (const entry of TENANT_PREDICATE_EXEMPTIONS) {
      const key = exemptionKey(entry)
      if (seen.has(key)) duplicateEntries.push(key)
      seen.add(key)
      if (entry.reason.length < 40) shortReasons.push(key)
      if (
        entry.category === 'UNSCOPED-PENDING' &&
        !/^UNSCOPED-PENDING: src\/contexts\/.+\.ts:\d+ — \S/u.test(entry.reason)
      ) {
        invalidPendingReasons.push(key)
      }

      const callables = (reports.get(entry.file) ?? []).filter(
        (report) => report.symbol === entry.symbol,
      )
      if (callables.length === 0) staleEntries.push(key)
      const claim = CATEGORY_CLAIMS[entry.category]
      if (claim !== undefined && !callables.filter(isTenantFree).some(claim)) {
        unprovenClaims.push(`${entry.category} ${key}`)
      }
    }

    expect({
      duplicateEntries,
      invalidPendingReasons,
      shortReasons,
      staleEntries,
      unprovenClaims,
    }).toEqual({
      duplicateEntries: [],
      invalidPendingReasons: [],
      shortReasons: [],
      staleEntries: [],
      unprovenClaims: [],
    })
  })
})
