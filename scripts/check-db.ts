import 'dotenv/config'
import { getDb } from '../src/shared/db/index.js'
import { reviews } from '../src/shared/db/schema/review.schema.js'

async function main() {
  const db = getDb()
  const rows = await db
    .select({
      text: reviews.text,
      reviewerName: reviews.reviewerName,
      createdAt: reviews.createdAt,
    })
    .from(reviews)
  console.log(`${rows.length} reviews`)
  for (const r of rows) {
    console.log(
      `${r.reviewerName}: "${r.text?.substring(0, 40) ?? 'NULL'}" (${r.createdAt?.toISOString()})`,
    )
  }
  process.exit(0)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
