// Seed demo reviews + inbox items for UI demos (direct DB inserts — no event
// flow). Inserts 6 reviews on the seed property with their inbox items (and
// replies where the fixture calls for one), so the inbox/dashboard/property
// UI has realistic content to render.
//
// Idempotent: reviews are keyed by externalId ('demo-review-N'); re-runs skip
// what already exists. Safe to run repeatedly after seed-e2e-user.ts.
//
// Usage:
//   pnpm exec tsx scripts/seed-demo-reviews.ts
// Env overrides: SEED_DEMO_EMAIL (default bozhidar@local.dev),
//   SEED_DEMO_PROPERTY_SLUG (default local-test-property)

import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { eq, and } from 'drizzle-orm'
import { getDb } from '../src/shared/db'
import { user, member } from '../src/shared/db/schema/auth'
import { properties } from '../src/shared/db/schema/property.schema'
import { reviews, replies } from '../src/shared/db/schema/review.schema'
import { inboxItems } from '../src/shared/db/schema/inbox.schema'
import { sha256Hex } from '../src/shared/domain/sha256'

const email = process.env.SEED_DEMO_EMAIL ?? 'bozhidar@local.dev'
const propertySlug = process.env.SEED_DEMO_PROPERTY_SLUG ?? 'local-test-property'

const DAY_MS = 24 * 60 * 60 * 1000
const now = () => new Date()
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS)
const daysAhead = (n: number) => new Date(Date.now() + n * DAY_MS)

type ReviewFixture = Readonly<{
  externalId: string
  rating: number
  reviewerName: string
  text: string
  reviewedAt: Date
  /** Eligibility clock (BQC-1): must be in the future for the review to be visible. */
  contentExpiresAt: Date
  inbox: Readonly<{
    status: 'open' | 'closed'
    escalated?: boolean
    closedAt?: Date
  }>
  reply?: Readonly<{
    text: string
    status: 'published' | 'pending_approval'
    submittedAt: Date
    approvedAt?: Date
    publishedAt?: Date
  }>
}>

const FIXTURES: ReadonlyArray<ReviewFixture> = [
  {
    externalId: 'demo-review-1',
    rating: 5,
    reviewerName: 'Maya Thompson',
    text: 'Absolutely fantastic experience from start to finish. The team was attentive, the space was spotless, and everything was ready ahead of schedule. Will definitely be coming back!',
    reviewedAt: daysAgo(2),
    contentExpiresAt: daysAhead(28),
    inbox: { status: 'open' },
  },
  {
    externalId: 'demo-review-2',
    rating: 3,
    reviewerName: 'Daniel Kim',
    text: 'Decent overall. Service was friendly but I waited longer than expected for my appointment. The quality of the work itself was good though, so I might give it another shot.',
    reviewedAt: daysAgo(20),
    contentExpiresAt: daysAhead(10),
    inbox: { status: 'open' },
  },
  {
    externalId: 'demo-review-3',
    rating: 5,
    reviewerName: 'Priya Nair',
    text: 'Best in town, hands down. Professional, punctual, and the result exceeded my expectations.',
    reviewedAt: daysAgo(10),
    contentExpiresAt: daysAhead(20),
    inbox: { status: 'closed', closedAt: daysAgo(9) },
    reply: {
      text: 'Thank you so much for the kind words, Priya! It was a pleasure having you — see you next time.',
      status: 'published',
      submittedAt: daysAgo(10),
      approvedAt: daysAgo(9),
      publishedAt: daysAgo(9),
    },
  },
  {
    externalId: 'demo-review-4',
    rating: 2,
    reviewerName: 'Jonas Weber',
    text: 'Not great this time. Had to reschedule twice and communication was slow.',
    reviewedAt: daysAgo(40),
    // Deliberately expired: invisible to eligibility-enforcing reads; the inbox
    // item is closed (closed-on-expiry).
    contentExpiresAt: daysAgo(10),
    inbox: { status: 'closed', closedAt: daysAgo(10) },
  },
  {
    externalId: 'demo-review-5',
    rating: 4,
    reviewerName: 'Sofia Petrova',
    text: 'Really good experience overall — one small mix-up with the booking time, but they sorted it out quickly and were very apologetic. Would recommend.',
    reviewedAt: daysAgo(5),
    contentExpiresAt: daysAhead(25),
    inbox: { status: 'open', escalated: true },
  },
  {
    externalId: 'demo-review-6',
    rating: 1,
    reviewerName: 'Marcus Reid',
    text: 'Very disappointed. The staff was rude when I asked a simple question and the issue was never resolved.',
    reviewedAt: daysAgo(1),
    contentExpiresAt: daysAhead(29),
    inbox: { status: 'open' },
    reply: {
      text: "Hi Marcus, I'm really sorry to hear about your experience — that's not the standard we hold ourselves to. I'd like to look into this personally and make it right. Please reach out to us directly and we'll sort it out.",
      status: 'pending_approval',
      submittedAt: daysAgo(0),
    },
  },
]

async function main(): Promise<void> {
  const db = getDb()

  const [seedUser] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1)
  if (!seedUser)
    throw new Error(`user not found: ${email} — run scripts/seed-e2e-user.ts first`)

  const memberships = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, seedUser.id))
    .limit(1)
  const organizationId = memberships[0]?.organizationId
  if (!organizationId) throw new Error(`no org membership for ${email}`)

  const [property] = await db
    .select({ id: properties.id })
    .from(properties)
    .where(
      and(
        eq(properties.organizationId, organizationId),
        eq(properties.slug, propertySlug),
      ),
    )
    .limit(1)
  if (!property)
    throw new Error(`property not found: ${propertySlug} in ${organizationId}`)

  console.log(
    `Seeding demo reviews for ${email} / ${organizationId} / ${propertySlug} (${property.id})`,
  )

  let insertedReviews = 0
  let insertedReplies = 0
  let insertedItems = 0

  for (const fx of FIXTURES) {
    const existing = await db
      .select({ id: reviews.id })
      .from(reviews)
      .where(
        and(
          eq(reviews.platform, 'google'),
          eq(reviews.externalId, fx.externalId),
          eq(reviews.organizationId, organizationId),
        ),
      )
      .limit(1)
    if (existing[0]) {
      console.log(`skip ${fx.externalId} — already exists`)
      continue
    }

    const reviewId = randomUUID()
    const fetchedAt = now()
    await db.insert(reviews).values({
      id: reviewId,
      organizationId,
      propertyId: property.id,
      platform: 'google',
      externalId: fx.externalId,
      externalLocationId: 'demo-location-1',
      reviewerName: fx.reviewerName,
      rating: fx.rating,
      text: fx.text,
      languageCode: 'en',
      reviewedAt: fx.reviewedAt,
      expiresAt: fx.contentExpiresAt,
      sourceCreatedAt: fx.reviewedAt,
      sourceUpdatedAt: fx.reviewedAt,
      firstFetchedAt: fetchedAt,
      lastFetchedAt: fetchedAt,
      contentExpiresAt: fx.contentExpiresAt,
      contentHash: sha256Hex(
        [String(fx.rating), fx.text, fx.reviewerName, 'en'].join('\0'),
      ),
    })
    insertedReviews += 1

    if (fx.reply) {
      await db.insert(replies).values({
        id: randomUUID(),
        reviewId,
        organizationId,
        text: fx.reply.text,
        status: fx.reply.status,
        source: 'internal',
        createdBy: seedUser.id,
        approvedBy: fx.reply.status === 'published' ? seedUser.id : null,
        submittedAt: fx.reply.submittedAt,
        approvedAt: fx.reply.approvedAt ?? null,
        publishedAt: fx.reply.publishedAt ?? null,
        publicationState: fx.reply.status === 'published' ? 'published' : null,
        publicationAttempts: fx.reply.status === 'published' ? 1 : 0,
      })
      insertedReplies += 1
    }

    await db.insert(inboxItems).values({
      id: randomUUID(),
      organizationId,
      propertyId: property.id,
      sourceType: 'review',
      sourceId: reviewId,
      status: fx.inbox.status,
      isEscalated: fx.inbox.escalated === true,
      escalatedAt: fx.inbox.escalated === true ? daysAgo(1) : null,
      escalatedBy: fx.inbox.escalated === true ? seedUser.id : null,
      sourceDate: fx.reviewedAt,
      platform: 'google',
      // BQC-1.2: legacy denormalized content columns stay NULL — live reads
      // resolve rating/snippet/reviewerName via the review lookup.
      rating: null,
      snippet: null,
      reviewerName: null,
      closedAt: fx.inbox.closedAt ?? null,
      firstReplySubmittedAt: fx.reply?.submittedAt ?? null,
      firstReplyPublishedAt: fx.reply?.publishedAt ?? null,
    })
    insertedItems += 1
    console.log(
      `inserted ${fx.externalId} (${fx.rating}★, inbox ${fx.inbox.status}${fx.inbox.escalated ? ', escalated' : ''}${fx.reply ? `, reply ${fx.reply.status}` : ''})`,
    )
  }

  console.log(
    `done: ${insertedReviews} reviews, ${insertedReplies} replies, ${insertedItems} inbox items inserted (${FIXTURES.length - insertedReviews} skipped)`,
  )
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('seed-demo-reviews failed:', err)
    process.exit(1)
  })
