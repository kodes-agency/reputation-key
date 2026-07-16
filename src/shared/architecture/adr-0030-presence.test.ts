// BQR-1.4: ADR 0030 must exist and remain the cited authority for
// identifier-only outbox/event payloads (closes baseline finding 4.4).

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const ADR_DIR = join(ROOT, 'docs', 'adr')
const EVENT_ADAPTER = join(ROOT, 'src', 'shared', 'outbox', 'event-adapter.ts')
const HEALTH = join(ROOT, 'src', 'shared', 'observability', 'health-metrics.ts')

describe('BQR-1.4: ADR 0030 and health schema consumers', () => {
  it('has docs/adr/0030-*.md on disk', () => {
    const files = readdirSync(ADR_DIR).filter(
      (f) => f.startsWith('0030-') && f.endsWith('.md'),
    )
    expect(files.length, 'expected exactly one ADR 0030 file').toBe(1)
    expect(files[0]).toMatch(/^0030-identifier-only/)
  })

  it('ADR 0030 documents identifier-only outbox decision', () => {
    const files = readdirSync(ADR_DIR).filter((f) => f.startsWith('0030-'))
    const body = readFileSync(join(ADR_DIR, files[0]!), 'utf-8')
    expect(body).toMatch(/identifier-only/i)
    expect(body).toMatch(/outbox/i)
    expect(body).toMatch(/status:\s*accepted/)
  })

  it('event-adapter cites ADR 0030 for content strip list', () => {
    const src = readFileSync(EVENT_ADAPTER, 'utf-8')
    expect(src).toContain('ADR 0030')
    expect(src).toContain('CONTENT_FIELDS_TO_STRIP')
  })

  it('health-metrics imports canonical Drizzle schema tables (no dual string table names)', () => {
    expect(existsSync(HEALTH)).toBe(true)
    const src = readFileSync(HEALTH, 'utf-8')
    expect(src).toContain("from '#/shared/db/schema/outbox.schema'")
    expect(src).toContain("from '#/shared/db/schema/review.schema'")
    expect(src).toContain("from '#/shared/db/schema/review-sync.schema'")
    // Forbidden: dual-truth raw table name strings without schema import
    expect(src).not.toMatch(/FROM outbox_events/)
    expect(src).not.toMatch(/FROM reviews\b/)
    expect(src).not.toMatch(/FROM review_sync_state/)
  })
})
