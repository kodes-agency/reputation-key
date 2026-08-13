// BQC-4.2 — ProcessingRouter unit tests.
//
// Phase BQC-4 §4/§4.2 + ADR 0048: the router is the ONE routing decision
// model — it resolves (propertyId, workloadClass) to a typed ProcessingTarget
// containing only approved execution references plus the routing-policy
// version, or to a typed blocked decision. 'us' is the only APPROVED beta
// cell; 'europe'/'global' are denied, 'unresolved'/missing region and a
// missing property all fail closed.
//
// The property-routing loader is a port: production wires a drizzle adapter
// (property context infrastructure); these tests use a deterministic stub.

import { describe, it, expect, vi } from 'vitest'
import {
  createProcessingRouter,
  providerRefForCell,
  workloadClassForJob,
  type PropertyRoutingRecord,
} from './processing-router'

function stubLoader(records: Record<string, PropertyRoutingRecord | null>) {
  return vi.fn(async (propertyId: string) => records[propertyId] ?? null)
}

const US_PROPERTY: PropertyRoutingRecord = {
  processingRegion: 'us',
  routingPolicyVersion: 2,
}

describe('ProcessingRouter.resolve (BQC-4.2)', () => {
  it('resolves a us-region property to the us cell target with queue + policy version', async () => {
    const loadPropertyRouting = stubLoader({ 'prop-1': US_PROPERTY })
    const router = createProcessingRouter({ loadPropertyRouting, cell: 'us' })

    const decision = await router.resolve(
      { kind: 'property', propertyId: 'prop-1' },
      'review.sync',
    )

    expect(decision).toEqual({
      kind: 'target',
      cell: 'us',
      region: 'us',
      queue: 'default',
      // BQC-4.3: the cell's provider endpoint REFERENCE (logical identifier —
      // never a URL; the composition root maps it to construction config).
      provider: 'gbp-default',
      routingPolicyVersion: 2,
    })
    expect(loadPropertyRouting).toHaveBeenCalledWith('prop-1')
  })

  it('gives every property-scoped workload class a queue from the router map (one cell today)', async () => {
    const router = createProcessingRouter({
      loadPropertyRouting: stubLoader({ 'prop-1': US_PROPERTY }),
      cell: 'us',
    })

    for (const workloadClass of [
      'review.sync',
      'reply.publish',
      'property.import',
    ] as const) {
      const decision = await router.resolve(
        { kind: 'property', propertyId: 'prop-1' },
        workloadClass,
      )
      expect(decision).toMatchObject({ kind: 'target', queue: 'default' })
    }
  })

  it.each(['europe', 'global'])(
    "blocks the denied '%s' region with region_denied",
    async (region) => {
      const router = createProcessingRouter({
        loadPropertyRouting: stubLoader({
          'prop-1': { processingRegion: region, routingPolicyVersion: 1 },
        }),
        cell: 'us',
      })

      const decision = await router.resolve(
        { kind: 'property', propertyId: 'prop-1' },
        'reply.publish',
      )

      expect(decision).toEqual({ kind: 'blocked', reason: 'region_denied', region })
    },
  )

  it.each([
    { region: 'unresolved', expected: 'unresolved' },
    { region: null, expected: null },
  ])(
    'blocks region $expected with region_unresolved (fail closed)',
    async ({ region, expected }) => {
      const router = createProcessingRouter({
        loadPropertyRouting: stubLoader({
          'prop-1': { processingRegion: region, routingPolicyVersion: 1 },
        }),
        cell: 'us',
      })

      const decision = await router.resolve(
        { kind: 'property', propertyId: 'prop-1' },
        'review.sync',
      )

      expect(decision).toEqual({
        kind: 'blocked',
        reason: 'region_unresolved',
        region: expected,
      })
    },
  )

  it('blocks a missing property with property_missing', async () => {
    const router = createProcessingRouter({
      loadPropertyRouting: stubLoader({}),
      cell: 'us',
    })

    const decision = await router.resolve(
      { kind: 'property', propertyId: 'prop-gone' },
      'review.sync',
    )

    expect(decision).toEqual({
      kind: 'blocked',
      reason: 'property_missing',
      region: null,
    })
  })

  it('targets the approved cell from the routing decision, not from the worker cell declaration', async () => {
    // A worker declaring another cell still gets 'us' targets — the mismatch
    // is the wrong-cell case the dispatch gate quarantines (ADR 0048).
    const router = createProcessingRouter({
      loadPropertyRouting: stubLoader({ 'prop-1': US_PROPERTY }),
      cell: 'europe',
    })

    const decision = await router.resolve(
      { kind: 'property', propertyId: 'prop-1' },
      'review.sync',
    )

    expect(decision).toMatchObject({ kind: 'target', cell: 'us' })
  })
})

describe('ProcessingRouter import-item routing', () => {
  it('routes tenant-keyed work without a Property identity', async () => {
    const loadPropertyRouting = stubLoader({})
    const loadImportItemRouting = vi.fn(async () => ({
      processingRegion: 'us',
      routingPolicyVersion: 2,
    }))
    const router = createProcessingRouter({
      loadPropertyRouting,
      loadImportItemRouting,
      cell: 'us',
    })

    const decision = await router.resolve(
      { kind: 'import_item', organizationId: 'org-1', itemId: 'item-1' },
      'property.import',
    )

    expect(decision).toMatchObject({
      kind: 'target',
      cell: 'us',
      routingPolicyVersion: 2,
    })
    expect(loadImportItemRouting).toHaveBeenCalledWith('org-1', 'item-1')
    expect(loadPropertyRouting).not.toHaveBeenCalled()
  })

  it('fails closed when the import-item loader is absent', async () => {
    const router = createProcessingRouter({
      loadPropertyRouting: stubLoader({}),
      cell: 'us',
    })

    await expect(
      router.resolve(
        { kind: 'import_item', organizationId: 'org-1', itemId: 'item-gone' },
        'property.import',
      ),
    ).resolves.toEqual({
      kind: 'blocked',
      reason: 'import_item_missing',
      region: null,
    })
  })

  it('rejects an import-item subject for any non-import workload', async () => {
    const loadImportItemRouting = vi.fn(async () => ({
      processingRegion: 'us',
      routingPolicyVersion: 2,
    }))
    const router = createProcessingRouter({
      loadPropertyRouting: stubLoader({}),
      loadImportItemRouting,
      cell: 'us',
    })

    await expect(
      router.resolve(
        { kind: 'import_item', organizationId: 'org-1', itemId: 'item-1' },
        'review.sync',
      ),
    ).resolves.toEqual({
      kind: 'blocked',
      reason: 'subject_workload_mismatch',
      region: null,
    })
    expect(loadImportItemRouting).not.toHaveBeenCalled()
  })
})

describe('workloadClassForJob (BQC-4.2)', () => {
  it('maps every routed protected job to its workload class', () => {
    expect(workloadClassForJob('sync-property-reviews')).toBe('review.sync')
    expect(workloadClassForJob('publish-reply')).toBe('reply.publish')
    expect(workloadClassForJob('import-gbp-property-item-v2')).toBe('property.import')
  })

  it('does not route the legacy org fan-out or tenant-cross sweeps', () => {
    expect(workloadClassForJob('purge-expired-reviews')).toBeUndefined()
    expect(workloadClassForJob('health-check')).toBeUndefined()
    expect(workloadClassForJob('unknown-job')).toBeUndefined()
  })
})

describe('providerRefForCell (BQC-4.3)', () => {
  it("returns the approved cell's logical provider reference", () => {
    expect(providerRefForCell('us')).toBe('gbp-default')
  })

  it.each(['europe', 'global', 'unresolved', 'ap-southeast-2', ''])(
    "returns undefined for the non-approved cell '%s' (no provider to fall back to)",
    (cell) => {
      expect(providerRefForCell(cell)).toBeUndefined()
    },
  )

  it('blocked routing decisions never carry a provider reference', async () => {
    const router = createProcessingRouter({
      loadPropertyRouting: stubLoader({
        'prop-1': { processingRegion: 'europe', routingPolicyVersion: 1 },
      }),
      cell: 'us',
    })

    const decision = await router.resolve(
      { kind: 'property', propertyId: 'prop-1' },
      'review.sync',
    )

    expect(decision.kind).toBe('blocked')
    expect('provider' in decision).toBe(false)
  })
})
