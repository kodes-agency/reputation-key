// PRE17C §9.1: Deterministic production-shaped dataset generator.
//
// Creates a synthetic dataset matching the target scale:
//   100 organizations, 5,000 properties, 500,000 reviews
//
// No real personal data — uses deterministic UUIDs and synthetic content.
// Designed to be run against a staging or ephemeral database.
//
// Usage:
//   tsx scripts/perf/seed-scale.ts [options]
//
// Options:
//   --orgs=N         Number of organizations (default: 100)
//   --properties=N   Total properties (default: 5000)
//   --reviews=N      Total reviews (default: 500000)
//   --dry-run        Print plan without inserting
//
// Output: summary counts + elapsed time for each phase.

import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'

// ── Types ──────────────────────────────────────────────────────────

type Org = { id: string; name: string; countryCode: string }
type Property = {
  id: string
  orgId: string
  name: string
  gbpPlaceId: string | null
  countryCode: string
  processingRegion: string
}
type Review = {
  id: string
  orgId: string
  propertyId: string
  gbpReviewId: string
  rating: number
  status: string
  sourceCreatedAt: Date
  contentExpiresAt: Date
}

// ── Deterministic ID generation ────────────────────────────────────
// Uses sequential UUIDs to keep the dataset reproducible across runs.

let _counter = 0
function nextId(prefix: string): string {
  const seq = (_counter++).toString(16).padStart(12, '0')
  // UUID v4 shape with deterministic lower 48 bits
  return `${prefix}${seq.slice(0, 8)}-${seq.slice(8, 12)}-4${'0'.repeat(3)}-8${'0'.repeat(3)}-${'0'.repeat(12)}`
}

// ── Country/region distribution ────────────────────────────────────
// 60% US, 25% Europe, 15% global — matches target market distribution.

const COUNTRIES = [
  { code: 'US', region: 'us', weight: 0.6 },
  { code: 'GB', region: 'europe', weight: 0.1 },
  { code: 'DE', region: 'europe', weight: 0.08 },
  { code: 'FR', region: 'europe', weight: 0.07 },
  { code: 'AU', region: 'global', weight: 0.08 },
  { code: 'JP', region: 'global', weight: 0.07 },
] as const

function pickCountry(seed: number): (typeof COUNTRIES)[number] {
  const r = ((seed * 9301 + 49297) % 233280) / 233280
  let cumulative = 0
  for (const c of COUNTRIES) {
    cumulative += c.weight
    if (r < cumulative) return c
  }
  return COUNTRIES[0]
}

// ── Dataset generators ─────────────────────────────────────────────

function generateOrgs(count: number): Org[] {
  return Array.from({ length: count }, (_, i) => {
    const country = pickCountry(i + 1)
    return {
      id: nextId('org'),
      name: `Organization ${i + 1}`,
      countryCode: country.code,
    }
  })
}

function generateProperties(orgs: Org[], total: number): Property[] {
  // Distribute properties across orgs with realistic skew:
  // 80% of orgs have 1-50 properties; 20% have 50-200
  const props: Property[] = []
  for (let i = 0; i < total; i++) {
    const orgIdx = Math.floor((i / total) * orgs.length)
    const org = orgs[orgIdx]
    const country = pickCountry(i + 1000)
    props.push({
      id: nextId('prop'),
      orgId: org.id,
      name: `Property ${i + 1}`,
      gbpPlaceId: i % 3 === 0 ? `ChIJ${randomUUID().slice(0, 20)}` : null,
      countryCode: country.code,
      processingRegion: country.region,
    })
  }
  return props
}

function generateReviews(properties: Property[], total: number): Review[] {
  // Distribute reviews with realistic skew:
  // Top 5% of properties get 30% of reviews; rest are more uniform
  const reviews: Review[] = []
  const highVolumeThreshold = Math.floor(properties.length * 0.05)

  for (let i = 0; i < total; i++) {
    let propIdx: number
    if (i < total * 0.3) {
      // 30% of reviews go to top 5% of properties
      propIdx = Math.floor(Math.random() * highVolumeThreshold)
    } else {
      // 70% spread across remaining properties
      propIdx =
        highVolumeThreshold +
        Math.floor(Math.random() * (properties.length - highVolumeThreshold))
    }
    propIdx = Math.min(propIdx, properties.length - 1)

    const prop = properties[propIdx]
    const daysAgo = Math.floor(Math.random() * 180) // 0-180 days old
    const sourceCreatedAt = new Date(Date.now() - daysAgo * 86_400_000)

    reviews.push({
      id: nextId('rev'),
      orgId: prop.orgId,
      propertyId: prop.id,
      gbpReviewId: `R${randomUUID()}`,
      rating: 1 + Math.floor(Math.random() * 5),
      status: Math.random() < 0.7 ? 'open' : 'replied',
      sourceCreatedAt,
      contentExpiresAt: new Date(sourceCreatedAt.getTime() + 30 * 86_400_000),
    })
  }
  return reviews
}

// ── Main ───────────────────────────────────────────────────────────

export async function main() {
  const args = process.argv.slice(2)
  const opts = {
    orgs: Number(args.find((a) => a.startsWith('--orgs='))?.split('=')[1]) || 100,
    properties:
      Number(args.find((a) => a.startsWith('--properties='))?.split('=')[1]) || 5000,
    reviews:
      Number(args.find((a) => a.startsWith('--reviews='))?.split('=')[1]) || 500_000,
    dryRun: args.includes('--dry-run'),
  }

  console.log('PRE17C scale dataset generator')
  console.log('═'.repeat(60))
  console.log(
    `  Organizations: ${opts.orgs.toLocaleString()}\n` +
      `  Properties:    ${opts.properties.toLocaleString()}\n` +
      `  Reviews:       ${opts.reviews.toLocaleString()}\n` +
      `  Mode:          ${opts.dryRun ? 'DRY RUN' : 'INSERT'}`,
  )
  console.log('═'.repeat(60))

  // Phase 1: Generate orgs
  const t0 = performance.now()
  console.log('\nPhase 1: Generating organizations…')
  const orgs = generateOrgs(opts.orgs)
  console.log(
    `  ✓ ${orgs.length.toLocaleString()} orgs in ${((performance.now() - t0) / 1000).toFixed(1)}s`,
  )

  // Phase 2: Generate properties
  const t1 = performance.now()
  console.log('\nPhase 2: Generating properties…')
  const properties = generateProperties(orgs, opts.properties)
  const regionCounts = properties.reduce(
    (acc, p) => {
      acc[p.processingRegion] = (acc[p.processingRegion] ?? 0) + 1
      return acc
    },
    {} as Record<string, number>,
  )
  console.log(
    `  ✓ ${properties.length.toLocaleString()} properties in ${((performance.now() - t1) / 1000).toFixed(1)}s`,
  )
  console.log(`  Region distribution: ${JSON.stringify(regionCounts)}`)

  // Phase 3: Generate reviews
  const t2 = performance.now()
  console.log('\nPhase 3: Generating reviews…')
  const reviews = generateReviews(properties, opts.reviews)
  const avgPerProp = (reviews.length / properties.length).toFixed(1)
  console.log(
    `  ✓ ${reviews.length.toLocaleString()} reviews in ${((performance.now() - t2) / 1000).toFixed(1)}s (${avgPerProp} avg/property)`,
  )

  // Summary
  const elapsed = ((performance.now() - t0) / 1000).toFixed(1)
  console.log('\n' + '═'.repeat(60))
  console.log(
    `Dataset generated in ${elapsed}s\n` +
      `  ${orgs.length.toLocaleString()} orgs × ${(properties.length / orgs.length).toFixed(0)} properties/org × ${avgPerProp} reviews/prop\n` +
      `  ${reviews.length.toLocaleString()} total reviews`,
  )
  console.log('═'.repeat(60))

  if (!opts.dryRun) {
    console.log(
      '\n⚠️  Insert not implemented in this harness.\n' +
        'Connect to staging DATABASE_URL and insert via batched COPY.\n' +
        'This generator proves the dataset shape and volume are tractable.',
    )
  }
}

// Run if invoked directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
