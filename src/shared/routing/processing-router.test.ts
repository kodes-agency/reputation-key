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

    const decision = await router.resolve('prop-1', 'review.sync')

    expect(decision).toEqual({
      kind: 'target',
      cell: 'us',
      region: 'us',
      queue: 'default',
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
      const decision = await router.resolve('prop-1', workloadClass)
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

      const decision = await router.resolve('prop-1', 'reply.publish')

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

      const decision = await router.resolve('prop-1', 'review.sync')

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

    const decision = await router.resolve('prop-gone', 'review.sync')

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

    const decision = await router.resolve('prop-1', 'review.sync')

    expect(decision).toMatchObject({ kind: 'target', cell: 'us' })
  })
})

describe('workloadClassForJob (BQC-4.2)', () => {
  it('maps the property-scoped protected jobs to workload classes', () => {
    expect(workloadClassForJob('sync-property-reviews')).toBe('review.sync')
    expect(workloadClassForJob('publish-reply')).toBe('reply.publish')
  })

  it('does not route the org-scoped import fan-out or tenant-cross sweeps', () => {
    // import-property is organization-scoped in the entry-point catalogue —
    // its per-property effects ride the sync jobs it spawns. Tenant-cross
    // sweeps (purge, retention, metric refresh) have no property to route.
    expect(workloadClassForJob('import-property')).toBeUndefined()
    expect(workloadClassForJob('purge-expired-reviews')).toBeUndefined()
    expect(workloadClassForJob('health-check')).toBeUndefined()
    expect(workloadClassForJob('unknown-job')).toBeUndefined()
  })
})
