import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { notificationEmailQueue } from './schema/notification.schema'

const migrationPath = resolve(
  process.cwd(),
  'drizzle/0161_notification_provider_acceptance_health_index.sql',
)

describe('0161 Notification provider-acceptance health index', () => {
  it('journals one expand-only migration after Recent Activity identifier compatibility', () => {
    const journal = JSON.parse(
      readFileSync(resolve(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number; when: number; tag: string }> }
    const migration = readFileSync(migrationPath, 'utf8')

    expect(journal.entries).toContainEqual(
      expect.objectContaining({
        idx: 161,
        when: 1790352000032,
        tag: '0161_notification_provider_acceptance_health_index',
      }),
    )
    expect(migration).not.toMatch(/\b(?:DROP|DELETE|UPDATE)\b/iu)
  })

  it('indexes only sendable immediate rows in delivery-lag scan order', () => {
    const migration = readFileSync(migrationPath, 'utf8')
    const indexes = getTableConfig(notificationEmailQueue).indexes
    const index = indexes.find(
      (candidate) =>
        candidate.config.name ===
        'notification_email_queue_immediate_acceptance_health_idx',
    )

    expect(index).toBeDefined()
    expect(migration).toContain(
      '"notification_email_queue_immediate_acceptance_health_idx"',
    )
    expect(migration).toContain('("created_at" DESC, "id")')
    expect(migration).toContain(
      'WHERE "cadence" = \'immediate\' AND "not_before" IS NULL',
    )
  })
})
