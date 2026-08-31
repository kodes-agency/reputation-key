import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string): string =>
  readFileSync(
    join(process.cwd(), 'src/contexts/notification/infrastructure', file),
    'utf8',
  )

describe('Notification runtime logging injection', () => {
  it('keeps jobs and durable consumers independent from the ambient logger', () => {
    for (const file of [
      'jobs/insert-notification.job.ts',
      'jobs/reconcile-missing-notifications.job.ts',
      'outbox-consumers.ts',
    ]) {
      expect(read(file), file).not.toMatch(/\bgetLogger\s*\(/u)
    }
  })
})
