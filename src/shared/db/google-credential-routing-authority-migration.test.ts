import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'drizzle/0133_google_credential_routing_authority.sql'),
  'utf8',
)

describe('0133 Google credential routing authority migration', () => {
  it('keeps legacy rows expand-safe while enforcing exact new writes', () => {
    expect(migration).toContain('credential_home_authority_generation')
    expect(migration).toContain('google_connections_credential_home_authority_fk')
    expect(migration).toContain('google_organization_credential_homes_current_idx')
    expect(migration.match(/NOT VALID/gu)).toHaveLength(3)
  })

  it('persists only signed routing metadata and broker hashes or opaque references', () => {
    expect(migration).toContain('google_credential_routing_directory_snapshots')
    expect(migration).toContain('google_credential_broker_replay')
    expect(migration).toContain('grant_id_hmac')
    expect(migration).toContain('material_locator')
    expect(migration).not.toMatch(
      /access_token|refresh_token|review_text|guest_content/iu,
    )
  })
})
