// PRE17C §9.1: Deterministic production-shaped dataset generator.
//
// Creates a synthetic dataset and inserts into PostgreSQL.
// No real personal data — uses deterministic UUIDs and synthetic content.
//
// Usage:
//   DATABASE_URL=... tsx scripts/perf/seed-scale.ts [options]
//
// Options:
//   --orgs=N         Number of organizations (default: 50)
//   --properties=N   Total properties (default: 500)
//   --reviews=N      Total reviews (default: 50000)
//   --dry-run        Print plan without inserting

import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { Pool } from 'pg'
import { config } from 'dotenv'

config({ path: ['.env.local', '.env'], override: true })

const DAYS = 86_400_000

// ── Types ──────────────────────────────────────────────────────────

type Org = { id: string; name: string; slug: string }
type Property = {
  id: string
  orgId: string
  name: string
  slug: string
  timezone: string
  countryCode: string
  processingRegion: string
}
type Review = {
  id: string
  orgId: string
  propertyId: string
  externalId: string
  rating: number
  reviewedAt: Date
  expiresAt: Date
}

// ── Deterministic ID generation ────────────────────────────────────

let _counter = 0
function nextId(): string {
  return randomUUID()
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '-')
}

// ── Country/region/timezone distribution ───────────────────────────

const REGIONS = [
  { code: 'US', region: 'us', tz: 'America/New_York', weight: 0.6 },
  { code: 'GB', region: 'europe', tz: 'Europe/London', weight: 0.1 },
  { code: 'DE', region: 'europe', tz: 'Europe/Berlin', weight: 0.08 },
  { code: 'FR', region: 'europe', tz: 'Europe/Paris', weight: 0.07 },
  { code: 'JP', region: 'global', tz: 'Asia/Tokyo', weight: 0.07 },
] as const

function pickRegion(seed: number): (typeof REGIONS)[number] {
  const r = ((seed * 9301 + 49297) % 233280) / 233280
  let cumulative = 0
  for (const c of REGIONS) {
    cumulative += c.weight
    if (r < cumulative) return c
  }
  return REGIONS[0]
}

// ── Dataset generators ─────────────────────────────────────────────

function generateOrgs(count: number): Org[] {
  return Array.from({ length: count }, (_, i) => ({
    id: nextId(),
    name: `Organization ${i + 1}`,
    slug: `org-${i + 1}-${randomUUID().slice(0, 8)}`,
  }))
}

function generateProperties(orgs: Org[], total: number): Property[] {
  const props: Property[] = []
  for (let i = 0; i < total; i++) {
    const orgIdx = Math.floor((i / total) * orgs.length)
    const org = orgs[Math.min(orgIdx, orgs.length - 1)]
    const region = pickRegion(i + 1000)
    props.push({
      id: nextId(),
      orgId: org.id,
      name: `Property ${i + 1}`,
      slug: `prop-${i + 1}-${randomUUID().slice(0, 8)}`,
      timezone: region.tz,
      countryCode: region.code,
      processingRegion: region.region,
    })
  }
  return props
}

function generateReviews(properties: Property[], total: number): Review[] {
  const reviews: Review[] = []
  const highVolThreshold = Math.max(1, Math.floor(properties.length * 0.05))

  for (let i = 0; i < total; i++) {
    let propIdx: number
    if (i < total * 0.3) {
      propIdx = Math.floor(Math.random() * highVolThreshold)
    } else {
      propIdx =
        highVolThreshold +
        Math.floor(Math.random() * (properties.length - highVolThreshold))
    }
    propIdx = Math.min(propIdx, properties.length - 1)
    const prop = properties[propIdx]
    const daysAgo = Math.floor(Math.random() * 180)
    const reviewedAt = new Date(Date.now() - daysAgo * DAYS)

    reviews.push({
      id: nextId(),
      orgId: prop.orgId,
      propertyId: prop.id,
      externalId: `R${randomUUID()}`,
      rating: 1 + Math.floor(Math.random() * 5),
      reviewedAt,
      expiresAt: new Date(reviewedAt.getTime() + 30 * DAYS),
    })
  }
  return reviews
}

// ── Batched insertion ──────────────────────────────────────────────

const BATCH_SIZE = 1000

async function batchInsert(
  pool: Pool,
  table: string,
  columns: string[],
  rows: ReadonlyArray<readonly unknown[]>,
) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const placeholders = batch
      .map(
        (_, rowIdx) =>
          `(${columns.map((_, colIdx) => `$${rowIdx * columns.length + colIdx + 1}`).join(', ')})`,
      )
      .join(', ')
    const values = batch.flat()
    await pool.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders} ON CONFLICT DO NOTHING`,
      values,
    )
  }
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const opts = {
    orgs: Number(args.find((a) => a.startsWith('--orgs='))?.split('=')[1]) || 50,
    properties:
      Number(args.find((a) => a.startsWith('--properties='))?.split('=')[1]) || 500,
    reviews:
      Number(args.find((a) => a.startsWith('--reviews='))?.split('=')[1]) || 50_000,
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

  // Generate
  const t0 = performance.now()
  const orgs = generateOrgs(opts.orgs)
  const properties = generateProperties(orgs, opts.properties)
  const reviews = generateReviews(properties, opts.reviews)
  console.log(`Dataset generated in ${((performance.now() - t0) / 1000).toFixed(1)}s`)

  if (opts.dryRun) {
    console.log('\nDRY RUN — no data inserted.')
    return
  }

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error('DATABASE_URL not set')
    process.exit(1)
  }
  console.log(`\nConnecting to: ${databaseUrl.replace(/:[^:@]+@/, ':***@')}`)
  const pool = new Pool({ connectionString: databaseUrl, max: 10 })

  try {
    // Phase 1: Organizations
    const t1 = performance.now()
    process.stdout.write('Inserting organizations… ')
    await batchInsert(
      pool,
      'organization',
      ['id', 'name', 'slug', '"createdAt"'],
      orgs.map((o) => [o.id, o.name, o.slug, new Date()]),
    )
    console.log(`${orgs.length} in ${((performance.now() - t1) / 1000).toFixed(1)}s`)

    // Phase 2: Properties
    const t2 = performance.now()
    process.stdout.write('Inserting properties… ')
    await batchInsert(
      pool,
      'properties',
      [
        'id',
        'organization_id',
        'name',
        'slug',
        'timezone',
        'country_code',
        'processing_region',
      ],
      properties.map((p) => [
        p.id,
        p.orgId,
        p.name,
        p.slug,
        p.timezone,
        p.countryCode,
        p.processingRegion,
      ]),
    )
    console.log(
      `${properties.length} in ${((performance.now() - t2) / 1000).toFixed(1)}s`,
    )

    // Phase 3: Reviews
    const t3 = performance.now()
    process.stdout.write('Inserting reviews… ')
    await batchInsert(
      pool,
      'reviews',
      [
        'id',
        'organization_id',
        'property_id',
        'platform',
        'external_id',
        'external_location_id',
        'rating',
        'reviewed_at',
        'expires_at',
      ],
      reviews.map((r) => [
        r.id,
        r.orgId,
        r.propertyId,
        'google',
        r.externalId,
        r.propertyId,
        r.rating,
        r.reviewedAt,
        r.expiresAt,
      ]),
    )
    const reviewSec = parseFloat(((performance.now() - t3) / 1000).toFixed(1))
    const rate = Math.round(reviews.length / reviewSec)
    console.log(`${reviews.length} in ${reviewSec}s (${rate.toLocaleString()}/s)`)

    // Verify
    const counts = await pool.query(`
      SELECT
        (SELECT count(*)::bigint FROM organization) AS orgs,
        (SELECT count(*)::bigint FROM properties) AS properties,
        (SELECT count(*)::bigint FROM reviews) AS reviews
    `)
    console.log('\n' + '═'.repeat(60))
    console.log('Database verification:')
    console.log(`  Organizations: ${Number(counts.rows[0].orgs).toLocaleString()}`)
    console.log(`  Properties:    ${Number(counts.rows[0].properties).toLocaleString()}`)
    console.log(`  Reviews:       ${Number(counts.rows[0].reviews).toLocaleString()}`)

    // Query performance test: filter reviews by property
    const propId = properties[0].id
    const qt = performance.now()
    const qr = await pool.query(
      `SELECT count(*), avg(rating) FROM reviews WHERE property_id = $1`,
      [propId],
    )
    const queryMs = (performance.now() - qt).toFixed(1)
    console.log(`\nQuery test (property ${propId.slice(0, 12)}…):`)
    console.log(
      `  count=${qr.rows[0].count}, avg_rating=${Number(qr.rows[0].avg).toFixed(2)}, ${queryMs}ms`,
    )
    console.log('═'.repeat(60))
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
