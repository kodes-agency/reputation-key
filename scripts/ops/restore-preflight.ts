// Operator CLI (BQC-7.5): restore/rollback PREFLIGHT — the honest "start
// restore according to runbook §8" surface. This is a guided checklist, NOT
// a PITR executor: point-in-time restore is platform-owned (Railway console /
// provider tooling); this command verifies the prerequisites an operator must
// confirm before starting it:
//
//   1. The target database is NOT the source database — DATABASE_URL must use
//      exact loopback for a local drill or the exact private hostname of the
//      named Railway PITR sibling in its matching Data Cell environment.
//   2. The migration journal (drizzle.__drizzle_migrations) is readable on
//      the target — the restored instance's schema state is inspectable.
//   3. The backup/PITR window is noted — confirm the restore point is inside
//      the platform's retention window (Railway console) BEFORE starting.
//
// Usage:
//   pnpm ops:restore-preflight --operator <id>
//
// Requires DATABASE_URL (pointed at the ISOLATED restore target). Read-only;
// policy-evaluated + audited like every operator command. Runbook §8:
// restore → PITR sibling, boot verifier isolated (RESTORE_MODE=isolated),
// verify with ops:restore-verify, cutover — the only rollback path, reserved
// for data loss. Full procedure: docs/operations/backup-and-lifecycle.md.

import { sql } from 'drizzle-orm'
import { getDb } from '../../src/shared/db'
import { getEnv } from '../../src/shared/config/env'
import { isIsolatedRestoreTarget } from '../../src/shared/config/restore-mode'
import { runOperatorCommand } from './operator-command'

const USAGE = 'pnpm ops:restore-preflight --operator <id>'

async function main(): Promise<void> {
  const result = await runOperatorCommand(
    {
      name: 'ops:restore-preflight',
      scope: 'global',
      usage: USAGE,
    },
    async (_ctx, _args, io) => {
      const env = getEnv()
      io.out(
        '\nrestore preflight (runbook §8) — PITR is platform-owned; this verifies prerequisites\n',
      )

      // 1. Attested restore target.
      if (!isIsolatedRestoreTarget(env.DATABASE_URL, env)) {
        io.err(
          'REFUSED: DATABASE_URL is not an admitted restore target — use exact loopback for a local drill or the named Railway PITR sibling private hostname in its matching Data Cell environment.',
        )
        return 1
      }
      io.out(
        '✓ restore target admitted — confirm the recorded tunnel/service is the PITR sibling',
      )

      // 2. Journal readable.
      const journal = await getDb().execute(
        sql`SELECT count(*)::int AS applied, max(created_at)::text AS last FROM "drizzle"."__drizzle_migrations"`,
      )
      const row = journal.rows[0] as { applied: number; last: string | null } | undefined
      io.out(
        `✓ migration journal readable — ${row?.applied ?? 0} applied migration(s), last at ${row?.last ?? 'n/a'}`,
      )

      // 3. Backup window + the runbook path.
      io.out(
        '· backup window: confirm the restore point is inside the platform PITR retention window (Railway console) BEFORE starting',
      )
      io.out('\nnext steps (runbook §8, docs/operations/backup-and-lifecycle.md):')
      io.out(
        '  1. PITR creates a new sibling Postgres service in this cell environment (Railway console — platform-owned)',
      )
      io.out('  2. Point DATABASE_URL at the restored instance; re-run this preflight')
      io.out(
        '  3. Boot ISOLATED: RESTORE_MODE=isolated (worker refuses to boot; web capabilities deny fail-closed)',
      )
      io.out(
        '  4. Run pnpm ops:restore-verify --operator <id> --reason <text> --apply --yes ops:restore-verify',
      )
      io.out(
        '     — enforces retention, invalidates restored authority, fences unpublished effects, and proves zero backlog',
      )
      io.out(
        '  5. Cut over only after verification (pin recovery run/generation, UNSET RESTORE_MODE, redeploy) — restore is the ONLY rollback path, reserved for data loss',
      )
      io.out('')
    },
  )
  process.exit(result.exitCode)
}

main().catch((err) => {
  console.error('ops:restore-preflight failed', err)
  process.exit(1)
})
