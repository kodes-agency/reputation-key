import 'dotenv/config'
import { getDb } from '../src/shared/db/index.js'
import { reviews } from '../src/shared/db/schema/review.schema.js'

// BQC-1.6: operator diagnostics must not print raw review content
// (reviewer names / text) to stdout — identifiers and clocks only.
async function main() {
  const db = getDb()
  const rows = await db
    .select({
      id: reviews.id,
      propertyId: reviews.propertyId,
      rating: reviews.rating,
      lastFetchedAt: reviews.lastFetchedAt,
      contentExpiresAt: reviews.contentExpiresAt,
      createdAt: reviews.createdAt,
    })
    .from(reviews)
  console.log(`${rows.length} reviews`)
  for (const r of rows) {
    console.log(
      `${r.id} property=${r.propertyId} rating=${r.rating} ` +
        `fetched=${r.lastFetchedAt?.toISOString() ?? 'NULL'} ` +
        `expires=${r.contentExpiresAt?.toISOString() ?? 'NULL'}`,
    )
  }
  process.exit(0)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
