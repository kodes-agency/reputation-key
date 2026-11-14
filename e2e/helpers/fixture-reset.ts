import { Redis } from 'ioredis'
import { TEST_ENV, dbQuery } from './fixture-db'

// ── Rate-limit budgets ────────────────────────────────────────────────

/**
 * Give the next guest a fresh rate-limit budget.
 *
 * Every spec in the suite arrives from one network (the Playwright host) at one
 * Portal, so the whole run shares one network+Portal budget
 * (src/contexts/guest/server/guest-rate-limit-budgets.ts). Past it a new rating
 * is no longer refused: it is kept and filtered automatically as
 * `network_volume` (ADR 0044, amended 2026-10-22), so a spec that reads a
 * Portal's Results would silently miss its own rating, and the other actions
 * still answer 429.
 *
 * Resetting between tests models what the budget is actually for: a different
 * guest, on a different network. It does not weaken the rule — within a single
 * test the limiter still binds, which is what the abuse cases exercise.
 *
 * BOTH halves have to go. `rateLimit()` consults the Redis limiter and then a
 * DURABLE network-pressure authority in Postgres with the same budget, so
 * clearing Redis alone changes nothing: the counters vanished and every submit
 * still returned 429.
 */
export async function resetGuestRateLimits(): Promise<void> {
  const redis = new Redis(TEST_ENV.REDIS_URL, { maxRetriesPerRequest: 2 })
  try {
    let cursor = '0'
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'ratelimit:*', 'COUNT', 500)
      cursor = next
      if (keys.length > 0) await redis.del(...keys)
    } while (cursor !== '0')
  } finally {
    redis.disconnect()
  }
  await dbQuery('DELETE FROM guest_network_pressure_records')
}

/**
 * Keep the seeded Portal's secondary destination approved-and-fresh.
 *
 * `resolveApprovedLinks` only serves destinations validated within the last 30
 * minutes. Production keeps that moving with a scheduled revalidation job; the
 * e2e stack runs no such job against fixture data, so a stack that has been up
 * longer than the window silently loses its destinations and the specs fail on
 * a decayed precondition rather than on the product.
 */
export async function refreshPortalDestinationApproval(): Promise<void> {
  await dbQuery(
    `UPDATE portal_approved_destinations SET last_validated_at = now()
     WHERE normalized_uri = 'https://example.com/reviews'`,
  )
}

/**
 * Soft-delete Portals a spec created but never removed.
 *
 * A journey that creates a Portal on every run and cleans up none of them
 * eventually breaks itself: the Property's Portal list is paginated, so after
 * enough runs the one the spec just created is no longer on the first page and
 * the assertion fails for a reason that has nothing to do with the product.
 *
 * Soft-delete rather than DELETE: Portals are referenced by tokens, publication
 * snapshots, activations and health intervals, all of which restrict removal by
 * design. `deleted_at` is what the product's own soft delete sets and what
 * every read filters on.
 */
export async function softDeleteFixturePortals(slugPrefix: string): Promise<void> {
  await dbQuery(
    `UPDATE portals SET deleted_at = now(), updated_at = now()
     WHERE slug LIKE $1 AND deleted_at IS NULL`,
    [`${slugPrefix}%`],
  )
}

/**
 * Drop everything queued on the fixture queue.
 *
 * A provider sync that fails keeps retrying, and the retries outlive the spec
 * that enqueued them. They then run against a GBP stub whose scope has moved on
 * to the next spec's account, 404 on every attempt, and burn the shared
 * 30-per-60s reviews quota that the next spec needs — so a suite of Google
 * journeys fails in combination while each one passes alone.
 *
 * Draining before a spec starts is the queue equivalent of
 * resetGuestRateLimits: it resets the counter, not the rule.
 */
