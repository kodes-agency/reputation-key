import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DB_ONLY_CONSTRUCTS } from './schema/db-only-constructs'

const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/0128_notification_source_content_free.sql'),
  'utf8',
)

describe('0128 Notification source-content independence', () => {
  it('normalizes old writers before validating the provider-rating invariant', () => {
    expect(migration).toContain('normalize_notification_source_content_v1')
    expect(migration).toContain("NEW.payload := NEW.payload - 'rating'")
    expect(migration).toContain("NEW.payload->>'platform' = 'portal'")
    expect(migration).toContain("'{guestRating}'")
    expect(migration).toContain('notifications_source_content_free_check')
    expect(migration).toContain(
      'VALIDATE CONSTRAINT "notifications_source_content_free_check"',
    )
  })

  it('registers the function and trigger as Notification-owned DB constructs', () => {
    expect(DB_ONLY_CONSTRUCTS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'normalize_notification_source_content_v1',
          kind: 'function',
          owner: 'notification',
          source: 'drizzle/0128_notification_source_content_free.sql',
        }),
        expect.objectContaining({
          name: 'notifications_normalize_source_content',
          kind: 'trigger',
          owner: 'notification',
          source: 'drizzle/0128_notification_source_content_free.sql',
        }),
      ]),
    )
  })
})
