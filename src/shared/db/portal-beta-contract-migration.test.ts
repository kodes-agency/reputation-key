import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'drizzle/0135_portal_beta_contract.sql'),
  'utf8',
)

describe('0135 Portal beta contract migration', () => {
  it('adds the durable health, destination, brand, locale, and stable-address records', () => {
    for (const table of [
      'portal_health_intervals',
      'portal_approved_destinations',
      'property_portal_brand_profiles',
      'property_portal_brand_contents',
      'portal_localized_overrides',
    ]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`)
    }
    expect(migration).toContain('portal_health_intervals_one_current')
    expect(migration).toContain('encrypted_raw_token')
    expect(migration).toContain('portal_tokens_encrypted_address_pair_valid')
    expect(migration).toContain("'published', 'retiring', 'retired', 'revoked'")
  })

  it('classifies every legacy raw link before enforcing its Property scope', () => {
    const addNullable = migration.indexOf(
      'ALTER TABLE "portal_links" ADD COLUMN "property_id" uuid;',
    )
    const classify = migration.indexOf('"legacy_destination_state" = \'quarantined\'')
    const assertComplete = migration.indexOf(
      "RAISE EXCEPTION 'portal link property backfill is incomplete'",
    )
    const enforceNotNull = migration.indexOf(
      'ALTER TABLE "portal_links" ALTER COLUMN "property_id" SET NOT NULL;',
    )

    expect(addNullable).toBeGreaterThan(-1)
    expect(classify).toBeGreaterThan(addNullable)
    expect(assertComplete).toBeGreaterThan(classify)
    expect(enforceNotNull).toBeGreaterThan(assertComplete)
    expect(migration).not.toContain(
      'ALTER TABLE "portal_links" ADD COLUMN "property_id" uuid NOT NULL',
    )
  })

  it('keeps legacy publication snapshots explicit instead of inventing brand provenance', () => {
    expect(migration).toContain('"brand_profile_version" integer')
    expect(migration).not.toMatch(
      /UPDATE\s+"portal_publication_snapshots"[\s\S]+brand_profile_version/iu,
    )
    expect(migration).toContain('DEFAULT \'["en"]\'::jsonb')
    expect(migration).toContain("'guest-ui-bg-v1'")
  })
})
