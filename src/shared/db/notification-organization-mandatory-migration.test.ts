import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = join(
  process.cwd(),
  'drizzle/0151_notification_organization_mandatory.sql',
)

describe('notification Organization mandatory migration', () => {
  it('makes only the notification delivery property scopes nullable', () => {
    const sql = readFileSync(migrationPath, 'utf8')

    expect(sql).toContain(
      'ALTER TABLE "notifications" ALTER COLUMN "property_id" DROP NOT NULL',
    )
    expect(sql).toContain(
      'ALTER TABLE "notification_email_queue" ALTER COLUMN "property_id" DROP NOT NULL',
    )
    expect(sql).not.toContain(
      'ALTER TABLE "notification_preferences" ALTER COLUMN "property_id" DROP NOT NULL',
    )
  })

  it('enforces category/scope parity and keeps mandatory email immediate', () => {
    const sql = readFileSync(migrationPath, 'utf8')

    expect(sql).toContain('notifications_mandatory_scope_check')
    expect(sql).toContain('notification_email_queue_mandatory_scope_check')
    expect(sql).toContain('notification_preferences_configurable_category_check')
    expect(sql).toContain('"cadence" = \'immediate\'')
  })

  it('removes legacy mandatory preferences and defines null-safe idempotency', () => {
    const sql = readFileSync(migrationPath, 'utf8')

    expect(sql).toContain(
      'DELETE FROM "notification_preferences" WHERE "category" = \'mandatory\'',
    )
    expect(sql).toContain('email_queue_property_idempotency_unique')
    expect(sql).toContain('email_queue_organization_idempotency_unique')
    expect(sql).toContain('WHERE "property_id" IS NULL')
    expect(sql).toContain('WHERE "property_id" IS NOT NULL')
  })
})
