// Delete KODES agency property and its reviews so you can re-import
// Run: npx tsx scripts/cleanup-kodes.ts

import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { getDb } from '../src/shared/db/index.js'
import { reviews } from '../src/shared/db/schema/review.schema.js'
import { properties } from '../src/shared/db/schema/property.schema.js'

async function main() {
  const db = getDb()

  // Delete reviews for the KODES property
  const kodesReviews = await db
    .select({ id: reviews.id })
    .from(reviews)
    .where(eq(reviews.propertyId, 'f43ce499-73eb-45a4-8e4d-288cd1264782'))

  console.log(`Deleting ${kodesReviews.length} KODES reviews...`)
  await db
    .delete(reviews)
    .where(eq(reviews.propertyId, 'f43ce499-73eb-45a4-8e4d-288cd1264782'))

  // Delete the KODES property
  console.log('Deleting KODES property...')
  await db
    .delete(properties)
    .where(eq(properties.id, 'f43ce499-73eb-45a4-8e4d-288cd1264782'))

  console.log('Done. You can now re-import the property.')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
