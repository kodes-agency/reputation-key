// Delete all properties and inbox items (plus reviews/replies as cascading deps)
// Run: npx tsx scripts/cleanup-all.ts

import 'dotenv/config'
import { getDb } from '../src/shared/db/index.js'
import { reviews, replies } from '../src/shared/db/schema/review.schema.js'
import { properties } from '../src/shared/db/schema/property.schema.js'
import { inboxItems } from '../src/shared/db/schema/inbox.schema.js'

async function main() {
  const db = getDb()

  const revCount = (await db.select({ id: reviews.id }).from(reviews)).length
  console.log(`Deleting ${revCount} reviews...`)
  await db.delete(reviews)

  const repCount = (await db.select({ id: replies.id }).from(replies)).length
  console.log(`Deleting ${repCount} replies...`)
  await db.delete(replies)

  const inboxCount = (await db.select({ id: inboxItems.id }).from(inboxItems)).length
  console.log(`Deleting ${inboxCount} inbox items...`)
  await db.delete(inboxItems)

  const propCount = (await db.select({ id: properties.id }).from(properties)).length
  console.log(`Deleting ${propCount} properties...`)
  await db.delete(properties)

  console.log('Done. All clean.')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
