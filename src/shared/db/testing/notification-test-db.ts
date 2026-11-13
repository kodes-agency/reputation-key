// Rows the notification integration suites need before a notice can be written:
// a Property the notice's foreign key points at. Written into the transaction a
// suite holds open.

import type { Database } from '#/shared/db'
import { properties } from '#/shared/db/schema'

export async function seedProperty(
  db: Database,
  property: Readonly<{ id: string; organizationId: string; name?: string }>,
): Promise<void> {
  await db.insert(properties).values({
    id: property.id,
    organizationId: property.organizationId,
    name: property.name ?? 'Harbor Hotel',
    slug: `notice-test-${property.id}`,
    timezone: 'UTC',
  })
}
