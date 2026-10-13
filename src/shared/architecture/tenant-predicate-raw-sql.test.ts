import { describe, expect, it } from 'vitest'
import {
  type CallableReport,
  type TenantTables,
  inspectTenantStatements,
} from './tenant-predicate-constraint'

const SYNTHETIC = 'synthetic.repository.ts'
// The tables the cases below name. `platform_controls` is nobody's tenant data.
const TABLES: TenantTables = {
  allExportNames: new Set(['replies', 'reviews', 'auditLogs', 'platformControls']),
  tenantExportNames: new Set(['replies', 'reviews', 'auditLogs']),
  tenantDatabaseNames: new Set(['replies', 'reviews', 'audit_logs']),
}

function findReplyReports(text: string): readonly CallableReport[] {
  const reports =
    inspectTenantStatements([{ file: SYNTHETIC, text }], TABLES).get(SYNTHETIC) ?? []
  return reports.filter((report) => report.symbol === 'findReply')
}

// Raw `sql` statements for the tenant-predicate canary (S12). In a raw
// statement the same interpolation can be a predicate, a projection or an
// assignment, so the rule turns on where the tenant value stands
// (raw-sql-position.ts) and on whether an interpolation is a value or SQL
// (raw-sql-fragments.ts). The builder cases are in
// tenant-predicate-canary.test.ts.
describe('canary: a raw statement is restricted only by a tenant value it filters by (S12)', () => {
  it.each([
    [
      'a projection value',
      `const findReply = async (organizationId: string, replyId: string) =>
        db.execute(sql\`
          SELECT id, \${organizationId} AS organization_id
          FROM replies WHERE id = \${replyId}\`)`,
    ],
    [
      'a projection value behind a helper',
      `const findReply = async (organizationId: OrganizationId, replyId: string) =>
        db.execute(sql\`
          SELECT id, \${unbrand(organizationId)} AS organization_id
          FROM replies WHERE id = \${replyId}\`)`,
    ],
    [
      'a projection value under another name',
      `const findReply = async (input: { organizationId: string; id: string }) => {
        const owner = input.organizationId
        return db.execute(sql\`
          SELECT id, \${owner} AS owner FROM replies WHERE id = \${input.id}\`)
      }`,
    ],
    [
      'a value the caller hands in and the filter compares with nothing',
      `const findReply = async (owner: string, replyId: string) =>
        db.execute(sql\`
          SELECT id FROM replies
          WHERE id = \${replyId} AND \${owner}::text IS NOT NULL\`)
      const findMine = (ctx: { organizationId: string }, replyId: string) =>
        findReply(ctx.organizationId, replyId)`,
    ],
    [
      'a value the filter mentions and compares with nothing',
      `const findReply = async (organizationId: OrganizationId, replyId: string) =>
        db.execute(sql\`
          SELECT id FROM replies
          WHERE id = \${replyId}
            AND \${unbrand(organizationId)}::text IS NOT NULL\`)`,
    ],
    [
      'a scalar subquery in the projection of an interpolated table',
      `const findReply = async (orgId: string, replyId: string) =>
        db.execute(sql\`
          SELECT r.id,
            (SELECT count(*) FROM reviews v WHERE v.organization_id = \${orgId}) AS total
          FROM \${replies} r WHERE r.id = \${replyId}\`)`,
    ],
    [
      'the row the statement files under the tenant',
      `const findReply = async (organizationId: string, replyId: string) =>
        db.execute(sql\`
          INSERT INTO audit_logs (organization_id, subject_id, body)
          SELECT \${organizationId}, r.id, r.body FROM replies r WHERE r.id = \${replyId}\`)`,
    ],
    [
      'an assignment',
      `const findReply = async (orgId: string, replyId: string) =>
        db.execute(sql\`
          UPDATE replies SET organization_id = \${orgId} WHERE id = \${replyId}\`)`,
    ],
    [
      'an assignment spliced in as a fragment',
      `const findReply = async (orgId: string, replyId: string) => {
        const assignment = sql\`organization_id = \${orgId}\`
        return db.execute(sql\`
          UPDATE replies SET \${assignment} WHERE id = \${replyId}\`)
      }`,
    ],
    [
      'a scalar subquery in the projection',
      `const findReply = async (orgId: string, replyId: string) =>
        db.execute(sql\`
          SELECT r.id,
            (SELECT count(*) FROM reviews v WHERE v.organization_id = \${orgId}) AS total
          FROM replies r WHERE r.id = \${replyId}\`)`,
    ],
    [
      'a CASE branch',
      `const findReply = async (orgId: string, replyId: string) =>
        db.execute(sql\`
          SELECT id FROM replies
          WHERE id = \${replyId}
            AND CASE WHEN organization_id = \${orgId} THEN true ELSE true END\`)`,
    ],
    [
      'one side of an OR',
      `const findReply = async (orgId: string, replyId: string) =>
        db.select().from(replies).where(
          sql\`\${replies.id} = \${replyId} OR \${replies.organizationId} = \${orgId}\`,
        )`,
    ],
    [
      'a predicate that is optional',
      `const findReply = async (replyId: string, orgId: string | null) =>
        db.execute(sql\`
          SELECT id FROM replies
          WHERE id = \${replyId}
            AND (\${orgId}::text IS NULL OR organization_id = \${orgId})\`)`,
    ],
    [
      'a subquery joined by OR',
      `const findReply = async (orgId: string, replyId: string) =>
        db.execute(sql\`
          SELECT id FROM replies
          WHERE id = \${replyId}
             OR review_id IN (
               SELECT id FROM reviews WHERE organization_id = \${orgId})\`)`,
    ],
    [
      'one of the conditions an OR joins',
      `const findReply = async (orgId: string, replyId: string) => {
        const conditions = [
          sql\`organization_id = \${orgId}\`,
          sql\`id = \${replyId}\`,
        ]
        return db.execute(sql\`
          SELECT id FROM replies WHERE \${sql.join(conditions, sql\` OR \`)}\`)
      }`,
    ],
    [
      'a subquery the statement excludes',
      `const findReply = async (orgId: string, replyId: string) =>
        db.execute(sql\`
          SELECT id FROM replies
          WHERE id = \${replyId}
            AND review_id NOT IN (
              SELECT id FROM reviews WHERE organization_id = \${orgId})\`)`,
    ],
    [
      'a negated list',
      `const findReply = async (orgIds: readonly string[], replyId: string) =>
        db.execute(sql\`
          SELECT id FROM replies
          WHERE id = \${replyId} AND organization_id NOT IN (\${orgIds})\`)`,
    ],
  ])('flags a raw statement whose only tenant value is %s', (_position, source) => {
    expect(findReplyReports(source)).toEqual([
      expect.objectContaining({ tenantStatements: 1, restrictedStatements: 0 }),
    ])
  })

  it.each([
    [
      'in a list',
      `const findReply = async (orgIds: readonly string[], replyId: string) =>
        db.execute(sql\`
          SELECT id FROM replies
          WHERE organization_id IN (\${orgIds}) AND id = \${replyId}\`)`,
    ],
    [
      'in an array',
      `const findReply = async (orgIds: readonly string[], replyId: string) =>
        db.execute(sql\`
          SELECT id FROM replies
          WHERE organization_id = ANY(\${orgIds}::text[]) AND id = \${replyId}\`)`,
    ],
    [
      'compared null-safely',
      `const findReply = async (orgId: string | null, replyId: string) =>
        db.execute(sql\`
          SELECT id FROM replies
          WHERE organization_id IS NOT DISTINCT FROM \${orgId} AND id = \${replyId}\`)`,
    ],
    [
      'in a row value',
      `const findReply = async (orgId: string, replyId: string) =>
        db.execute(sql\`
          SELECT id FROM replies
          WHERE (organization_id, id) = (\${orgId}, \${replyId}::uuid)\`)`,
    ],
    [
      'held equal to an interpolated tenant column',
      `const findReply = async (owner: { id: string }, replyId: string) =>
        db.select().from(replies).where(
          sql\`\${replies.organizationId} = \${owner.id} AND \${replies.id} = \${replyId}\`,
        )`,
    ],
    [
      'beside an OR it does not belong to',
      `const findReply = async (orgId: string, replyId: string) =>
        db.execute(sql\`
          SELECT id FROM replies
          WHERE organization_id = \${orgId}
            AND (id = \${replyId} OR review_id = \${replyId})
          -- index or planner order, 'newest or oldest' first
          ORDER BY created_at DESC\`)`,
    ],
    [
      'in a subquery the statement filters by',
      `const findReply = async (orgId: string, replyId: string) =>
        db.execute(sql\`
          SELECT id FROM replies
          WHERE id = \${replyId}
            AND review_id IN (
              SELECT id FROM reviews WHERE organization_id = \${orgId})\`)`,
    ],
    [
      'in a common table expression',
      `const findReply = async (orgId: string, replyId: string) =>
        db.execute(sql\`
          WITH scoped AS (
            SELECT id FROM replies WHERE organization_id = \${orgId}
          )
          SELECT id FROM scoped WHERE id = \${replyId} OR id IS NULL\`)`,
    ],
    [
      'in a fragment spliced into the statement',
      `const findReply = async (orgId: string, replyId: string) => {
        const scope = sql\`WHERE organization_id = \${orgId}\`
        return db.execute(sql\`
          SELECT id FROM replies \${scope} AND id = \${replyId}\`)
      }`,
    ],
    [
      'in the conditions an AND joins',
      `const findReply = async (orgId: string, replyId: string) => {
        const conditions = [
          sql\`organization_id = \${orgId}\`,
          sql\`id = \${replyId}\`,
        ]
        return db.execute(sql\`
          SELECT id FROM replies WHERE \${sql.join(conditions, sql\` AND \`)}\`)
      }`,
    ],
    [
      'in a fragment that brings its own FROM and WHERE',
      `const ownedReplies = (orgId: string) =>
        sql\`FROM replies r WHERE r.organization_id = \${orgId}\`
      const findReply = async (orgId: string, replyId: string) =>
        db.execute(sql\`
          SELECT r.id \${ownedReplies(orgId)} AND r.id = \${replyId}\`)`,
    ],
    [
      'in the only subquery that reads tenant rows',
      `const findReply = async (orgId: string, replyId: string | null) =>
        db.execute(sql\`
          SELECT control.version FROM platform_controls control
          WHERE control.enabled
            AND (\${replyId}::uuid IS NULL OR EXISTS (
              SELECT 1 FROM replies r
              WHERE r.id = \${replyId}::uuid AND r.organization_id = \${orgId}))\`)`,
    ],
    [
      'in every subquery of a statement with no table of its own',
      `const findReply = async (orgId: string) =>
        db.execute(sql\`
          SELECT
            (SELECT count(*) FROM \${replies} WHERE \${replies.organizationId} = \${orgId})
            + (SELECT count(*) FROM reviews WHERE organization_id = \${orgId}) AS total\`)`,
    ],
    [
      'in the subquery an insert is conditional on',
      `const findReply = async (orgId: string, body: string) =>
        db.execute(sql\`
          INSERT INTO replies (organization_id, body)
          SELECT \${orgId}, \${body}
          WHERE NOT EXISTS (
            SELECT 1 FROM reviews WHERE organization_id = \${orgId})\`)`,
    ],
    [
      'the row the statement only inserts',
      `const findReply = async (input: { organizationId: string; body: string }) =>
        db.execute(sql\`
          INSERT INTO replies (organization_id, body)
          VALUES (\${input.organizationId}, \${input.body})
          ON CONFLICT (organization_id, review_id) DO UPDATE SET body = EXCLUDED.body
          RETURNING id\`)`,
    ],
  ])('accepts a raw statement whose tenant value is %s', (_position, source) => {
    expect(findReplyReports(source)).toEqual([
      expect.objectContaining({ tenantStatements: 1, restrictedStatements: 1 }),
    ])
  })
})
