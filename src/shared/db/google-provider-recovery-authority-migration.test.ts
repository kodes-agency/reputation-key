import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('0164 Google provider recovery authority migration', () => {
  it('is appended at the assigned immutable journal position', () => {
    const journal = JSON.parse(read('drizzle/meta/_journal.json')) as {
      entries: Array<{ idx: number; when: number; tag: string }>
    }
    expect(journal.entries.find((entry) => entry.idx === 164)).toEqual({
      idx: 164,
      version: '7',
      when: 1790352000035,
      tag: '0164_google_provider_recovery_authority',
      breakpoints: true,
    })
  })

  it('keeps exchange material encrypted and bounded and revoke permits exact', () => {
    const migration = read('drizzle/0164_google_provider_recovery_authority.sql')
    expect(migration).toContain('"encrypted_result" text')
    expect(migration).toContain('"response_expires_at" timestamp with time zone')
    expect(migration).toContain("interval '00:01:00'")
    expect(migration).toContain('attempt.cleanup_work_permit_id = permit.id')
    expect(migration).toContain("attempt.state = 'dispatching'")
    expect(migration).toContain('FOR UPDATE OF permit')
    expect(migration).toContain('start_google_execution_permit_v2(')
    expect(migration).not.toMatch(/code_verifier|refresh_token|access_token|id_token/iu)
  })
})
