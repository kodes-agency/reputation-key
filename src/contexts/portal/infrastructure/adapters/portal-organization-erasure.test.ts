import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { portalLookOverrides } from '#/shared/db/schema/portal-look.schema'
import { PORTAL_PURGE_PLAN } from './portal-organization-erasure'

describe('Portal erasure plan', () => {
  it('names a bounded purge plan of row deletes, never drops', () => {
    expect(PORTAL_PURGE_PLAN).toContain('portals')
    expect(PORTAL_PURGE_PLAN).toContain('portal_groups')
    for (const table of PORTAL_PURGE_PLAN) {
      expect(table).not.toMatch(/drop|truncate/i)
    }
    // Other owners' rows are never in a Portal plan.
    for (const foreign of [
      'properties',
      'guest_responses',
      'portal_metric_lifetime_aggregates',
      'portal_responsibilities',
      'portal_group_memberships',
    ]) {
      expect(PORTAL_PURGE_PLAN).not.toContain(foreign)
    }
  })

  it('deletes link texts before the links they hang from', () => {
    expect(PORTAL_PURGE_PLAN).toContain('portal_link_texts')
    expect(PORTAL_PURGE_PLAN.indexOf('portal_link_texts')).toBeLessThan(
      PORTAL_PURGE_PLAN.indexOf('portal_links'),
    )
  })

  it('deletes the group history before the groups it hangs from', () => {
    expect(PORTAL_PURGE_PLAN).toContain('portal_group_history')
    expect(PORTAL_PURGE_PLAN.indexOf('portal_group_history')).toBeLessThan(
      PORTAL_PURGE_PLAN.indexOf('portal_groups'),
    )
  })

  it('deletes address downloads before the tokens they point at', () => {
    expect(PORTAL_PURGE_PLAN).toContain('portal_address_downloads')
    expect(PORTAL_PURGE_PLAN.indexOf('portal_address_downloads')).toBeLessThan(
      PORTAL_PURGE_PLAN.indexOf('portal_tokens'),
    )
  })

  it('deletes the remembered last prints before the Portals they hang from', () => {
    expect(PORTAL_PURGE_PLAN).toContain('portal_last_prints')
    expect(PORTAL_PURGE_PLAN.indexOf('portal_last_prints')).toBeLessThan(
      PORTAL_PURGE_PLAN.indexOf('portals'),
    )
  })

  it('deletes the saved print wordings before the Portals they hang from', () => {
    expect(PORTAL_PURGE_PLAN).toContain('portal_print_wordings')
    expect(PORTAL_PURGE_PLAN.indexOf('portal_print_wordings')).toBeLessThan(
      PORTAL_PURGE_PLAN.indexOf('portals'),
    )
  })

  it('deletes the page-edit ledger before the Portals it hangs from', () => {
    expect(PORTAL_PURGE_PLAN).toContain('portal_page_edits')
    expect(PORTAL_PURGE_PLAN.indexOf('portal_page_edits')).toBeLessThan(
      PORTAL_PURGE_PLAN.indexOf('portals'),
    )
  })

  // The table is a child of the Portals and of the images, both ON DELETE
  // RESTRICT, so a purge that reached either first would fail on the first
  // Organization that gave a Portal its own look.
  it('deletes a Portal’s own look after the wording overrides and before the Portals and images it hangs from', () => {
    const at = PORTAL_PURGE_PLAN.indexOf('portal_look_overrides')
    expect(at).toBeGreaterThan(-1)
    expect(at).toBeGreaterThan(PORTAL_PURGE_PLAN.indexOf('portal_localized_overrides'))
    for (const later of [
      'property_portal_brand_contents',
      'property_portal_brand_profiles',
      'portal_media_assets',
      'portals',
    ] as const) {
      expect(at, later).toBeLessThan(PORTAL_PURGE_PLAN.indexOf(later))
    }
  })

  it('has every table a Portal’s own look points at later in the plan, read from the schema', () => {
    const at = PORTAL_PURGE_PLAN.indexOf('portal_look_overrides')
    const targets = getTableConfig(portalLookOverrides).foreignKeys.map(
      (key) => getTableConfig(key.reference().foreignTable).name,
    )
    expect(new Set(targets)).toEqual(new Set(['portals', 'portal_media_assets']))
    for (const target of targets) {
      expect(PORTAL_PURGE_PLAN.indexOf(target as never), target).toBeGreaterThan(at)
    }
  })

  it('names a Portal’s own look once', () => {
    expect(
      PORTAL_PURGE_PLAN.filter((table) => table === 'portal_look_overrides'),
    ).toHaveLength(1)
  })
})
