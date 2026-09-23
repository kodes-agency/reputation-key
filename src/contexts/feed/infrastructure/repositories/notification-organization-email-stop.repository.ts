// Feed notification surface — reads the Identity-owned Organization lifecycle
// authority for email delivery (LIF-01).
//
// A closure request used to be expected to suspend the Organization, which
// the capability gate would then refuse with `org_suspended`. Nothing commits
// that suspension any more, so the email paths read the authority row
// directly: its state and whether a cancelled closure still awaits
// reactivation. Identifiers and a state only; no tenant content.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { NotificationOrganizationEmailStopPort } from '../../application/ports/notification-organization-email-stop.port'
import { organizationEmailStop } from '../../domain/organization-email-stop'

type LifecycleRow = Readonly<{ state: string; reactivation_required: boolean }>

export const createNotificationOrganizationEmailStopReader =
  (db: Pick<Database, 'execute'>): NotificationOrganizationEmailStopPort =>
  async (organizationId) => {
    const result = await db.execute<LifecycleRow>(sql`
      SELECT state, reactivation_required
        FROM organization_lifecycle_authority
       WHERE organization_id = ${organizationId}
    `)
    const row = result.rows[0]
    return organizationEmailStop(
      row ? { state: row.state, reactivationRequired: row.reactivation_required } : null,
    )
  }
