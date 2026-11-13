// Feed notification surface — the escalation-resolution lookup, against real
// PostgreSQL.
//
// The port is content-free and Organization-fenced. A queued delivery reaches
// the adapter with an inbox item id it never owned, so the fence is what keeps
// another Organization's assignee and Property name out of a notice, and the
// result shape is what keeps guest text out of one.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import { inboxItemId, organizationId } from '#/shared/domain/ids'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { seedProperty } from '#/shared/db/testing/notification-test-db'
import { createEscalationResolutionLookupAdapter } from './escalation-resolution-lookup.adapter'

const ORG = organizationId('escalation-lookup-org')
const OTHER_ORG = organizationId('escalation-lookup-other-org')
const PROPERTY = 'b8100000-0000-4000-8000-000000000010'
const OTHER_PROPERTY = 'b8100000-0000-4000-8000-000000000011'
const ITEM = inboxItemId('b8100000-0000-4000-8000-000000000040')
const UNASSIGNED_ITEM = inboxItemId('b8100000-0000-4000-8000-000000000041')
const OTHER_ORG_ITEM = inboxItemId('b8100000-0000-4000-8000-000000000042')
const ASSIGNEE = 'escalation-lookup-assignee'
const RESOLVER = 'escalation-lookup-resolver'
const ESCALATED_AT = new Date('2026-06-01T09:00:00.000Z')
const RESOLVED_AT = new Date('2026-06-01T10:00:00.000Z')

describe('escalation resolution lookup (real PostgreSQL)', () => {
  let held: HeldTransaction
  let db: Database

  const seedItem = (
    id: string,
    organization: string,
    property: string,
    values: Readonly<{ assignedTo: string | null; resolved: boolean }>,
  ) =>
    held.client.query(
      `INSERT INTO inbox_items
         (id, organization_id, property_id, source_type, source_id, source_date,
          assigned_to, is_escalated, escalated_at, escalation_resolved_at,
          escalation_resolved_by, created_at, updated_at)
       VALUES ($1, $2, $3, 'feedback', $4, NOW(), $5, $6, $7, $8, $9, NOW(), NOW())`,
      [
        id,
        organization,
        property,
        id,
        values.assignedTo,
        !values.resolved,
        ESCALATED_AT,
        values.resolved ? RESOLVED_AT : null,
        values.resolved ? RESOLVER : null,
      ],
    )

  beforeAll(async () => {
    held = await holdTransaction()
    db = held.db
    await seedProperty(db, { id: PROPERTY, organizationId: ORG, name: 'Seaside Hotel' })
    await seedProperty(db, {
      id: OTHER_PROPERTY,
      organizationId: OTHER_ORG,
      name: 'Other Org Hotel',
    })
    await seedItem(ITEM, ORG, PROPERTY, { assignedTo: ASSIGNEE, resolved: true })
    await seedItem(UNASSIGNED_ITEM, ORG, PROPERTY, { assignedTo: null, resolved: false })
    await seedItem(OTHER_ORG_ITEM, OTHER_ORG, OTHER_PROPERTY, {
      assignedTo: 'other-org-assignee',
      resolved: true,
    })
  })

  afterAll(async () => {
    await held?.rollBack()
  })

  const lookup = () => createEscalationResolutionLookupAdapter(db)

  it('returns the resolution facts and the Property name of the caller’s own Organization', async () => {
    const facts = await lookup().findEscalationResolutionFacts(ITEM, ORG)

    expect(facts).toEqual({
      propertyId: PROPERTY,
      assignedTo: ASSIGNEE,
      propertyName: 'Seaside Hotel',
      isEscalated: false,
      escalatedAt: ESCALATED_AT,
      resolvedAt: RESOLVED_AT,
      resolvedBy: RESOLVER,
    })
  })

  it('finds nothing for an item id that belongs to another Organization', async () => {
    expect(await lookup().findEscalationResolutionFacts(OTHER_ORG_ITEM, ORG)).toBeNull()
    expect(await lookup().findEscalationResolutionFacts(ITEM, OTHER_ORG)).toBeNull()
  })

  it('returns null for an item that does not exist', async () => {
    const missing = inboxItemId('b8100000-0000-4000-8000-0000000000ff')

    expect(await lookup().findEscalationResolutionFacts(missing, ORG)).toBeNull()
  })

  it('keeps an unassigned, still-open item as nulls and an open flag', async () => {
    const facts = await lookup().findEscalationResolutionFacts(UNASSIGNED_ITEM, ORG)

    expect(facts).toMatchObject({
      assignedTo: null,
      resolvedAt: null,
      resolvedBy: null,
      isEscalated: true,
    })
  })

  it('still returns the facts, without a name, when the Property row is hidden by its Organization', async () => {
    // The item's Organization no longer owns the Property row it names: the
    // name must not be read across the fence, and the facts must still come.
    await held.client.query(`UPDATE properties SET organization_id = $1 WHERE id = $2`, [
      OTHER_ORG,
      PROPERTY,
    ])

    const facts = await lookup().findEscalationResolutionFacts(ITEM, ORG)

    expect(facts).toMatchObject({ propertyId: PROPERTY, propertyName: null })
    await held.client.query(`UPDATE properties SET organization_id = $1 WHERE id = $2`, [
      ORG,
      PROPERTY,
    ])
  })

  it('carries exactly the port fields, so no guest content reaches the caller', async () => {
    const facts = await lookup().findEscalationResolutionFacts(ITEM, ORG)

    expect(Object.keys(facts ?? {}).sort()).toEqual([
      'assignedTo',
      'escalatedAt',
      'isEscalated',
      'propertyId',
      'propertyName',
      'resolvedAt',
      'resolvedBy',
    ])
  })
})
