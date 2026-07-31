// Operator CLI (BQC-7.5): restore/rollback PREFLIGHT — the honest "start
// restore according to runbook §8" surface. This is a guided checklist, NOT
// a PITR executor: point-in-time restore is platform-owned (Railway console /
// provider tooling); this command verifies the prerequisites an operator must
// confirm before starting it:
//
//   1. The target database is NOT production-shaped — DATABASE_URL must point
//      at an isolated/local instance (localhost). A restore never runs
//      against a live/shared target; the command refuses otherwise.
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
// restore → PITR to isolated project, boot isolated (RESTORE_MODE=isolated),
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

      // 1. Isolated target.
      if (!isIsolatedRestoreTarget(env.DATABASE_URL)) {
        io.err(
          'REFUSED: DATABASE_URL is not an isolated/local target — never restore into a live or shared database. ' +
            'Point DATABASE_URL at the isolated restore instance (PITR target) and re-run.',
        )
        return 1
      }
      io.out('✓ target is isolated (localhost) — not production-shaped')

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
        '  1. PITR to an isolated project (Railway console / provider tooling — platform-owned)',
      )
      io.out('  2. Point DATABASE_URL at the restored instance; re-run this preflight')
      io.out(
        '  3. Boot ISOLATED: RESTORE_MODE=isolated (worker refuses to boot; web capabilities deny fail-closed)',
      )
      io.out(
        '  4. Run pnpm ops:restore-verify --operator <id> --reason <text> --apply --yes ops:restore-verify',
      )
      io.out('     — runs the source-policy purge and proves zero expired rows remain')
      io.out(
        '  5. Cut over only after verification (UNSET RESTORE_MODE + redeploy) — restore is the ONLY rollback path, reserved for data loss',
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
