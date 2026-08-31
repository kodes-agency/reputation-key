// Read-only beta identity reconciliation report (SAFE-02).
//
// Classifies every account represented by Better Auth or the app-owned binding
// table as exact | mappable | conflict | orphan. It never changes state and it
// never guesses an Organization for ambiguous accounts.
//
//   pnpm audit:user-organization-bindings
//   pnpm audit:user-organization-bindings -- --details

import 'dotenv/config'
import { getPool } from '../src/shared/db/pool.js'
import {
  classifyUserOrganizationBinding,
  type UserOrganizationBindingAuditCategory,
} from '../src/shared/auth/user-organization-binding-audit.js'
import type { UserOrganizationBindingState } from '../src/shared/auth/user-organization-binding.js'

type AuditRow = Readonly<{
  userId: string
  membershipOrganizationIds: ReadonlyArray<string>
  bindingOrganizationId: string | null
  bindingState: UserOrganizationBindingState | null
}>

const categories: ReadonlyArray<UserOrganizationBindingAuditCategory> = [
  'exact',
  'mappable',
  'conflict',
  'orphan',
]

async function main() {
  const details = process.argv.includes('--details')
  const pool = getPool()
  const result = await pool.query<AuditRow>(
    `WITH subjects AS (
       SELECT id AS user_id FROM "user"
       UNION
       SELECT "userId" AS user_id FROM member
       UNION
       SELECT user_id FROM user_organization_bindings
     ), membership_rollup AS (
       SELECT "userId" AS user_id,
              array_agg(DISTINCT "organizationId" ORDER BY "organizationId") AS organization_ids
         FROM member
        GROUP BY "userId"
     )
     SELECT subjects.user_id AS "userId",
            COALESCE(membership_rollup.organization_ids, ARRAY[]::text[]) AS "membershipOrganizationIds",
            binding.organization_id AS "bindingOrganizationId",
            binding.state AS "bindingState"
       FROM subjects
       LEFT JOIN membership_rollup USING (user_id)
       LEFT JOIN user_organization_bindings binding USING (user_id)
      ORDER BY subjects.user_id`,
  )

  const classified = result.rows.map((row) => {
    const category = classifyUserOrganizationBinding({
      membershipOrganizationIds: row.membershipOrganizationIds,
      binding:
        row.bindingState === null
          ? null
          : {
              organizationId: row.bindingOrganizationId,
              state: row.bindingState,
            },
    })
    return { ...row, category }
  })

  const counts = Object.fromEntries(
    categories.map((category) => [
      category,
      classified.filter((row) => row.category === category).length,
    ]),
  ) as Record<UserOrganizationBindingAuditCategory, number>

  console.log(
    JSON.stringify(
      {
        report: 'user-organization-bindings',
        mode: 'read-only',
        total: classified.length,
        counts,
      },
      null,
      2,
    ),
  )

  if (details) {
    for (const row of classified.filter((entry) => entry.category !== 'exact')) {
      console.log(
        JSON.stringify({
          category: row.category,
          userId: row.userId,
          membershipOrganizationIds: row.membershipOrganizationIds,
          bindingOrganizationId: row.bindingOrganizationId,
          bindingState: row.bindingState,
        }),
      )
    }
  }

  if (counts.mappable + counts.conflict + counts.orphan > 0) {
    process.exitCode = 1
  }
}

main()
  .catch((error) => {
    console.error('audit-user-organization-bindings: error', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await getPool().end()
  })
