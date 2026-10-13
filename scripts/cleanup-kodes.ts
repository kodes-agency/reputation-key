// Delete KODES agency property and its reviews so you can re-import
// Run: pnpm exec tsx scripts/cleanup-kodes.ts
//
// Local development only. The deletes commit on their own, so the script
// first proves the target is this developer's own database
// (scripts/local/local-only-database.ts) and refuses a deployed one before a
// connection is opened.

import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { getDb } from '../src/shared/db/index.js'
import { reviews } from '../src/shared/db/schema/review.schema.js'
import { properties } from '../src/shared/db/schema/property.schema.js'
import { assertLocalOnlyDatabase } from './local/local-only-database'

async function main() {
  const target = assertLocalOnlyDatabase(process.env)
  console.log(`Target: database ${target.database} on ${target.host}`)
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
