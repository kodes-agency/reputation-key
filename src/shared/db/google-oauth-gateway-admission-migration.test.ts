import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('0162 Google OAuth gateway admission migration', () => {
  it('is appended at the assigned immutable journal position', () => {
    const journal = JSON.parse(read('drizzle/meta/_journal.json')) as {
      entries: Array<{ idx: number; when: number; tag: string }>
    }
    expect(journal.entries.find((entry) => entry.idx === 162)).toEqual({
      idx: 162,
      version: '7',
      when: 1790352000033,
      tag: '0162_google_oauth_gateway_admission',
      breakpoints: true,
    })
  })

  it('keeps first exchange connectionless, home-bound, and one-use', () => {
    const migration = read('drizzle/0162_google_oauth_gateway_admission.sql')
    expect(migration).toContain("permit.state <> 'admitted'")
    expect(migration).toContain('FOR UPDATE OF permit')
    expect(migration).toContain(
      "permit.authorization_vector->>'oauthCredentialOperation'",
    )
    expect(migration).toContain('connection.id IS NULL')
    expect(migration).toContain('home.superseded_at IS NULL')
    expect(migration).toContain(
      "THEN 'started'::public.authorization_execution_permit_state",
    )
    expect(migration).toContain(
      "ELSE 'fenced'::public.authorization_execution_permit_state",
    )
    expect(migration).not.toMatch(/code_verifier|refresh_token|client_secret/iu)
  })
})
