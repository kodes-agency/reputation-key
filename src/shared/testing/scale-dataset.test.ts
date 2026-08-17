// BQC-8.1 — unit tests for the deterministic scale dataset planner.
//
// Hermetic (no DB): determinism of the id stream and manifest hash, LCG
// quality, skew/region distributions, FK consistency, and the manifest
// round-trip. DB load/verify/clean are covered by the integration suite.

import { describe, it, expect } from 'vitest'
import {
  SCALE_DATASET_VERSION,
  createLcg,
  deterministicUuid,
  planScaleDataset,
  createManifest,
  serializeManifest,
  parseManifest,
  reviewRowValues,
  propertyRowValues,
  orgRowValues,
  type DatasetShape,
} from './scale-dataset'

const SHAPE: DatasetShape = { orgs: 3, properties: 40, reviews: 1000 }

const materialize = (seed: string, shape: DatasetShape) => {
  const plan = planScaleDataset({ seed, shape })
  return {
    plan,
    orgs: [...plan.orgs()],
    properties: [...plan.properties()],
    reviews: [...plan.reviews()],
  }
}

describe('deterministic ids', () => {
  it('produces RFC-4122 v5-shaped uuids from seed+kind+ordinal', () => {
    const id = deterministicUuid('seed-1', 'property', 7)
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    // Stable across calls.
    expect(deterministicUuid('seed-1', 'property', 7)).toBe(id)
    // Distinct per ordinal / kind / seed.
    expect(deterministicUuid('seed-1', 'property', 8)).not.toBe(id)
    expect(deterministicUuid('seed-1', 'review', 7)).not.toBe(id)
    expect(deterministicUuid('seed-2', 'property', 7)).not.toBe(id)
  })
})

describe('LCG (Park-Miller)', () => {
  it('is repeatable for the same seed and ranges over [0,1)', () => {
    const a = createLcg(42)
    const b = createLcg(42)
    const seqA = Array.from({ length: 1000 }, () => a())
    const seqB = Array.from({ length: 1000 }, () => b())
    expect(seqA).toEqual(seqB)
    expect(Math.min(...seqA)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...seqA)).toBeLessThan(1)
    // Not degenerate.
    expect(new Set(seqA.map((v) => v.toFixed(6))).size).toBeGreaterThan(900)
  })

  it('differs across seeds', () => {
    const a = createLcg(1)
    const b = createLcg(2)
    expect(a()).not.toBe(b())
  })
})

describe('plan determinism', () => {
  it('same seed + same shape → byte-identical streams and hash', () => {
    const first = materialize('alpha', SHAPE)
    const second = materialize('alpha', SHAPE)
    expect(first.orgs).toEqual(second.orgs)
    expect(first.properties).toEqual(second.properties)
    expect(first.reviews).toEqual(second.reviews)
    expect(first.plan.hash).toBe(second.plan.hash)
    expect(first.plan.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('different seed or shape → different hash', () => {
    const base = planScaleDataset({ seed: 'alpha', shape: SHAPE })
    expect(planScaleDataset({ seed: 'beta', shape: SHAPE }).hash).not.toBe(base.hash)
    expect(
      planScaleDataset({ seed: 'alpha', shape: { ...SHAPE, reviews: 1001 } }).hash,
    ).not.toBe(base.hash)
  })

  it('pins a regression anchor hash for a known seed+shape', () => {
    // If this value changes, every stored manifest hash becomes stale — a
    // deliberate, reviewed event (bump SCALE_DATASET_VERSION with it).
    const plan = planScaleDataset({
      seed: 'anchor',
      shape: { orgs: 2, properties: 10, reviews: 100 },
    })
    expect(plan.hash).toBe(
      'b84e14be37b1a6255ce62a7932f9743558593573a8adeb6a1b371e41c20ff5ef',
    )
  })

  it('binds the lifecycle profile into the dataset identity', () => {
    const capacity = planScaleDataset({ seed: 'profile', shape: SHAPE })
    const lifecycle = planScaleDataset({
      seed: 'profile',
      shape: SHAPE,
      sourceLifecycle: true,
    })

    expect(capacity.sourceLifecycle).toBe(false)
    expect(lifecycle.sourceLifecycle).toBe(true)
    expect(lifecycle.hash).not.toBe(capacity.hash)
  })
})

describe('plan content', () => {
  const { orgs, properties, reviews } = materialize('content', SHAPE)

  it('spreads properties across orgs and keeps ids/slugs unique', () => {
    expect(orgs).toHaveLength(3)
    expect(new Set(orgs.map((o) => o.id)).size).toBe(3)
    expect(new Set(orgs.map((o) => o.slug)).size).toBe(3)
    expect(properties).toHaveLength(40)
    expect(new Set(properties.map((p) => p.id)).size).toBe(40)
    // Org assignment covers every org and references real org ids.
    const orgIds = new Set(orgs.map((o) => o.id))
    expect(new Set(properties.map((p) => p.orgId)).size).toBe(3)
    for (const p of properties) expect(orgIds.has(p.orgId)).toBe(true)
  })

  it('keeps every review consistent with its property and org', () => {
    const byId = new Map(properties.map((p) => [p.id, p]))
    expect(reviews).toHaveLength(1000)
    for (const r of reviews) {
      const property = byId.get(r.propertyId)
      expect(property, `review ${r.id} property`).toBeDefined()
      expect(r.orgId).toBe(property!.orgId)
      expect(r.rating).toBeGreaterThanOrEqual(1)
      expect(r.rating).toBeLessThanOrEqual(5)
      expect(r.daysAgo).toBeGreaterThanOrEqual(0)
      expect(r.daysAgo).toBeLessThan(180)
    }
    expect(new Set(reviews.map((r) => r.externalId)).size).toBe(1000)
  })

  it('concentrates ~30% of reviews on the top 5% of properties (skew)', () => {
    const counts = new Map<string, number>()
    for (const r of reviews) counts.set(r.propertyId, (counts.get(r.propertyId) ?? 0) + 1)
    const sorted = [...counts.values()].sort((a, b) => b - a)
    const topCount = Math.max(1, Math.floor(properties.length * 0.05))
    const topShare = sorted.slice(0, topCount).reduce((a, b) => a + b, 0) / reviews.length
    expect(topShare).toBeGreaterThanOrEqual(0.25)
    expect(topShare).toBeLessThanOrEqual(0.35)
  })

  it('is US-heavy with denied Europe/global cases for routing proofs', () => {
    const big = materialize('regions', { orgs: 10, properties: 5000, reviews: 10 })
    const byRegion = new Map<string, number>()
    for (const p of big.properties) {
      byRegion.set(p.processingRegion, (byRegion.get(p.processingRegion) ?? 0) + 1)
    }
    const total = big.properties.length
    const us = (byRegion.get('us') ?? 0) / total
    expect(us).toBeGreaterThan(0.6)
    expect(us).toBeLessThan(0.75)
    // Denied cells must exist — the router proofs need them.
    expect(byRegion.get('europe') ?? 0).toBeGreaterThan(0)
    expect(byRegion.get('global') ?? 0).toBeGreaterThan(0)
    // Europe properties carry Europe country codes.
    for (const p of big.properties) {
      if (p.processingRegion === 'europe')
        expect(['GB', 'DE', 'FR']).toContain(p.countryCode)
      if (p.processingRegion === 'us') expect(p.countryCode).toBe('US')
    }
  })
})

describe('row value mapping', () => {
  it('anchors review timestamps to baseTime (not part of the hash)', () => {
    const { reviews } = materialize('rows', { orgs: 1, properties: 2, reviews: 3 })
    const base = new Date('2026-07-31T00:00:00.000Z')
    const row = reviewRowValues(reviews[0], base, true)
    const reviewedAt = row[7] as Date
    const expiresAt = row[8] as Date
    const lastFetchedAt = row[9] as Date
    const contentExpiresAt = row[10] as Date
    const contentHash = row[11] as string
    expect(expiresAt.getTime() - reviewedAt.getTime()).toBe(30 * 86_400_000)
    expect(lastFetchedAt).toEqual(reviewedAt)
    expect(contentExpiresAt).toEqual(expiresAt)
    expect(contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(row[12]).toBe(0)
    expect(row[13]).toBe(1)
    expect(row[14]).toBe(0)
    expect(row[15]).toBeGreaterThan(0)
    expect(row[16]).toMatch(/^[a-f0-9]{64}$/)
    expect(base.getTime() - reviewedAt.getTime()).toBe(reviews[0].daysAgo * 86_400_000)
    expect(row[3]).toBe('google')
  })

  it('maps org and property rows with the routing policy version', () => {
    const { orgs, properties } = materialize('rows', {
      orgs: 1,
      properties: 2,
      reviews: 1,
    })
    const base = new Date('2026-07-31T00:00:00.000Z')
    expect(orgRowValues(orgs[0], base)).toEqual([
      orgs[0].id,
      orgs[0].name,
      orgs[0].slug,
      base,
    ])
    const prow = propertyRowValues(properties[0])
    expect(prow).toEqual([
      properties[0].id,
      properties[0].orgId,
      properties[0].name,
      properties[0].slug,
      properties[0].timezone,
      properties[0].countryCode,
      properties[0].processingRegion,
      properties[0].routingPolicyVersion,
    ])
  })
})

describe('manifest', () => {
  it('round-trips and carries seed/version/shape/hash/createdAt', () => {
    const plan = planScaleDataset({ seed: 'alpha', shape: SHAPE })
    const manifest = createManifest(plan, new Date('2026-07-31T12:00:00.000Z'))
    expect(manifest).toEqual({
      seed: 'alpha',
      version: SCALE_DATASET_VERSION,
      shape: SHAPE,
      sourceLifecycle: false,
      hash: plan.hash,
      createdAt: '2026-07-31T12:00:00.000Z',
    })
    expect(parseManifest(serializeManifest(manifest))).toEqual(manifest)
  })

  it('rejects malformed manifests (fail closed)', () => {
    expect(() => parseManifest('nope')).toThrow(SyntaxError)
    expect(() => parseManifest('{"seed":"a"}')).toThrow(/shape/)
    const plan = planScaleDataset({ seed: 'alpha', shape: SHAPE })
    const manifest = createManifest(plan, new Date())
    const tampered = { ...manifest, hash: '0'.repeat(64) }
    expect(() => parseManifest(JSON.stringify(tampered))).not.toThrow() // parses…
    // …but no longer matches a recomputed plan (the CLI verify checks this).
    expect(tampered.hash).not.toBe(plan.hash)
  })
})
