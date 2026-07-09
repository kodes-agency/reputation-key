// Production preflight for DAC Stage 2 enablement (ADR 0001).
//
// Audits every member.role value and exits non-zero if any member carries a
// non-built-in role (anything other than owner/admin/member). Run before flipping
// ENABLE_CUSTOM_ROLES=true and after each deploy while the flag stays off, to
// catch roles introduced through any path that bypassed the app-owned services.
//
//   pnpm audit:member-roles
//
// Non-built-in roles in production mean a write path bypassed the app-owned role
// services — the raw better-auth endpoints are permanently blocked at the HTTP
// boundary (src/routes/api/auth/$.ts), so the only legitimate write path is the
// app-owned service layer. Remediate by reassigning affected members to a built-in
// role (owner/admin/member) before proceeding. See docs/adr/0001-dynamic-access-control.md.
import 'dotenv/config'
import { getPool } from '../src/shared/db/pool.js'

async function main() {
  const pool = getPool()
  const { rows } = await pool.query<{
    organizationId: string
    role: string
    members: number
  }>(
    `SELECT "organizationId", "role", count(*)::int AS members
     FROM member
     GROUP BY "organizationId", "role"
     ORDER BY "role"`,
  )

  const offenders = rows.filter(
    (r) => r.role !== 'owner' && r.role !== 'admin' && r.role !== 'member',
  )

  if (offenders.length === 0) {
    const totalMembers = rows.reduce((n, r) => n + r.members, 0)
    console.log(
      `audit-member-roles: OK — all ${totalMembers} member(s) across ${rows.length} role value(s) are built-in (owner/admin/member).`,
    )
    process.exit(0)
  }

  console.error(
    `audit-member-roles: FAIL — ${offenders.length} non-built-in role value(s) detected:`,
  )
  for (const o of offenders) {
    console.error(
      `  org=${o.organizationId} role=${JSON.stringify(o.role)} members=${o.members}`,
    )
  }
  console.error(
    'A write path bypassed the app-owned role services. Reassign affected members to a built-in role (owner/admin/member) before enabling ENABLE_CUSTOM_ROLES.',
  )
  process.exit(1)
}

main().catch((e) => {
  console.error('audit-member-roles: error', e)
  process.exit(1)
})
