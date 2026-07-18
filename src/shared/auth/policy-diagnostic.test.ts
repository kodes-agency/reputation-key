// BQC-4.4 — operator region diagnostic (2.7 surface extension), unit tests.
//
// Content-free by construction: region facts, the router's blocked reason,
// and the current cell + LOGICAL provider reference — never URLs, secrets,
// or tenant content. The router (real createProcessingRouter with a stubbed
// loader) stays the ONE routing decision model; the diagnostic reports what
// the router decides.

import { describe, it, expect, vi } from 'vitest'
import { createRegionDiagnostic } from './policy-diagnostic'
import { createProcessingRouter } from '#/shared/routing/processing-router'

const ORG = 'org-region-diag'
const PROP = 'd4000000-0000-4000-8000-000000000099'

type RegionRow = Readonly<{
  processingRegion: string | null
  processingRegionSource: string | null
  routingPolicyVersion: number
}>

const setup = (rows: Readonly<Record<string, RegionRow>>) => {
  const loadPropertyRegion = vi.fn(async (organizationId: string, propertyId: string) => {
    if (organizationId !== ORG) return null
    return rows[propertyId] ?? null
  })
  const router = createProcessingRouter({
    loadPropertyRouting: async (propertyId) => {
      const row = rows[propertyId]
      return row
        ? {
            processingRegion: row.processingRegion,
            routingPolicyVersion: row.routingPolicyVersion,
          }
        : null
    },
    cell: 'us',
  })
  const resolveRouting = vi.fn((propertyId: string) =>
    router.resolve(propertyId, 'review.sync'),
  )
  const getRegionDiagnostic = createRegionDiagnostic({
    loadPropertyRegion,
    resolveRouting,
    cell: 'us',
    providerRef: 'gbp-default',
  })
  return { getRegionDiagnostic, loadPropertyRegion, resolveRouting }
}

describe('createRegionDiagnostic (BQC-4.4)', () => {
  it('reports a processable us property with cell + logical provider ref', async () => {
    const { getRegionDiagnostic } = setup({
      [PROP]: {
        processingRegion: 'us',
        processingRegionSource: 'country_default',
        routingPolicyVersion: 2,
      },
    })

    const result = await getRegionDiagnostic({ organizationId: ORG, propertyId: PROP })

    expect(result).toEqual({
      propertyId: PROP,
      processingRegion: 'us',
      processingRegionSource: 'country_default',
      routingPolicyVersion: 2,
      processable: true,
      blockedReason: null,
      cell: 'us',
      providerRef: 'gbp-default',
    })
  })

  it('reports unresolved as region_unresolved', async () => {
    const { getRegionDiagnostic } = setup({
      [PROP]: {
        processingRegion: 'unresolved',
        processingRegionSource: 'country_default',
        routingPolicyVersion: 1,
      },
    })

    const result = await getRegionDiagnostic({ organizationId: ORG, propertyId: PROP })

    expect(result.processable).toBe(false)
    expect(result.blockedReason).toBe('region_unresolved')
  })

  it.each(['europe', 'global'])('reports %s as region_denied', async (region) => {
    const { getRegionDiagnostic } = setup({
      [PROP]: {
        processingRegion: region,
        processingRegionSource: 'google_address',
        routingPolicyVersion: 1,
      },
    })

    const result = await getRegionDiagnostic({ organizationId: ORG, propertyId: PROP })

    expect(result.processable).toBe(false)
    expect(result.blockedReason).toBe('region_denied')
  })

  it('reports a missing property as property_missing without calling the router', async () => {
    const { getRegionDiagnostic, resolveRouting } = setup({})

    const result = await getRegionDiagnostic({ organizationId: ORG, propertyId: PROP })

    expect(result).toEqual({
      propertyId: PROP,
      processingRegion: null,
      processingRegionSource: null,
      routingPolicyVersion: null,
      processable: false,
      blockedReason: 'property_missing',
      cell: 'us',
      providerRef: 'gbp-default',
    })
    expect(resolveRouting).not.toHaveBeenCalled()
  })

  it('scopes to the caller org — a cross-org property reports property_missing', async () => {
    const { getRegionDiagnostic, resolveRouting } = setup({
      [PROP]: {
        processingRegion: 'us',
        processingRegionSource: 'country_default',
        routingPolicyVersion: 1,
      },
    })

    const result = await getRegionDiagnostic({
      organizationId: 'org-other',
      propertyId: PROP,
    })

    expect(result.blockedReason).toBe('property_missing')
    expect(result.processingRegion).toBeNull()
    expect(resolveRouting).not.toHaveBeenCalled()
  })

  it('is content-free: no URLs, secrets, or env values in the output', async () => {
    const { getRegionDiagnostic } = setup({
      [PROP]: {
        processingRegion: 'us',
        processingRegionSource: 'country_default',
        routingPolicyVersion: 1,
      },
    })

    const serialized = JSON.stringify(
      await getRegionDiagnostic({ organizationId: ORG, propertyId: PROP }),
    )
    expect(serialized).not.toContain('http')
    expect(serialized).not.toContain('BETA_')
    expect(serialized).not.toContain('googleapis')
  })
})
