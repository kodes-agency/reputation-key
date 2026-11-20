// The order in which the hourly digest sweep visits recipients, and how many
// it reads per tick.
//
// Daily rows wait up to a day for the recipient's local 08:00, so recipients
// in every timezone are due at every tick. Read in id order under the cap, the
// same first recipients were visited every hour — mostly outside their window
// — and those past the cap were never visited until their rows went stale.
// Work due at any hour (a quiet-hours release, a transient retry) now comes
// first, then recipients whose 08:00 is now. The timezone mirrors the job's
// resolution (the person's zone, else the Organization's modal active
// Property zone, else UTC); only zones PostgreSQL knows are used, so one bad
// value cannot fail the query. It only orders the read: the job still decides
// the window per recipient.

import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'

/** Recipients one sweep reads at most. */
export const DUE_RECIPIENT_SWEEP_CAP = 5_000

type DueRecipientRow = Readonly<{ organization_id: string; user_id: string }>

export async function dueRecipientsInVisitOrder(
  db: Database,
  input: Readonly<{ due: SQL; now: Date; limit: number }>,
): Promise<readonly DueRecipientRow[]> {
  const result = await db.execute<DueRecipientRow>(sql`
    WITH due AS (
      SELECT organization_id, user_id, bool_or(status <> 'pending') AS any_hour
        FROM notification_email_queue
       WHERE ${input.due}
       GROUP BY organization_id, user_id
    ),
    known_zones AS MATERIALIZED (SELECT name FROM pg_timezone_names),
    organization_zone AS (
      SELECT DISTINCT ON (organization_id) organization_id, timezone
        FROM properties
       WHERE organization_id IN (SELECT organization_id FROM due)
         AND deleted_at IS NULL
         AND lifecycle_state = 'active'
       GROUP BY organization_id, timezone
       ORDER BY organization_id, count(*) DESC, min(created_at) ASC
    )
    SELECT d.organization_id, d.user_id
      FROM due d
      LEFT JOIN notification_user_settings s
        ON s.user_id = d.user_id AND s.organization_id = d.organization_id
      LEFT JOIN known_zones user_zone ON user_zone.name = s.timezone
      LEFT JOIN organization_zone o ON o.organization_id = d.organization_id
      LEFT JOIN known_zones org_zone ON org_zone.name = o.timezone
     ORDER BY d.any_hour DESC,
              EXTRACT(HOUR FROM (${input.now.toISOString()}::timestamptz
                AT TIME ZONE COALESCE(user_zone.name, org_zone.name, 'UTC'))) = 8 DESC,
              d.organization_id,
              d.user_id
     LIMIT ${input.limit}
  `)
  return result.rows
}
