// One person in two accounts (Organizations), and two people in one, against
// real PostgreSQL. A preference, a category default, a quiet window and a
// Property override are each keyed by (user, Organization): an answer given in
// one account must never decide delivery in another, and reading one account
// must never list the other's rows.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { seedProperty } from '#/shared/db/testing/notification-test-db'
import * as store from './notification-preferences.server'

const ORG_A = organizationId('pref-accounts-org-a')
const ORG_B = organizationId('pref-accounts-org-b')
const PERSON = userId('pref-accounts-person')
const COLLEAGUE = userId('pref-accounts-colleague')
const PROPERTY_A = propertyId('86300000-0000-4000-8000-00000000000a')
const PROPERTY_B = propertyId('86300000-0000-4000-8000-00000000000b')
const AT = new Date('2026-09-01T08:00:00.000Z')

const preference = (overrides: Partial<Parameters<typeof store.upsert>[1]> = {}) =>
  ({
    userId: PERSON,
    organizationId: ORG_A,
    propertyId: PROPERTY_A,
    category: 'workflow_collaboration',
    channel: 'email',
    enabled: true,
    cadence: 'immediate',
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  }) as Parameters<typeof store.upsert>[1]

const categoryDefault = (
  overrides: Partial<Parameters<typeof store.saveCategoryDefault>[1]> = {},
) =>
  ({
    userId: PERSON,
    organizationId: ORG_A,
    category: 'workflow_collaboration',
    channel: 'email',
    enabled: true,
    cadence: 'daily',
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  }) as Parameters<typeof store.saveCategoryDefault>[1]

describe('notification preferences across accounts (real PostgreSQL)', () => {
  let held: HeldTransaction
  let db: Database

  beforeAll(async () => {
    held = await holdTransaction()
    db = held.db
    await seedProperty(db, { id: PROPERTY_A, organizationId: ORG_A })
    await seedProperty(db, { id: PROPERTY_B, organizationId: ORG_B })
  })

  afterAll(async () => {
    await held?.rollBack()
  })

  const resolve = (user: string, org: string, property: string) =>
    store.resolveForDelivery(db, user, org, property, 'workflow_collaboration', 'email')

  it('delivers by the answer of the account the notice belongs to, not the same person’s other account', async () => {
    await store.upsert(db, preference({ enabled: false }))
    await store.upsert(
      db,
      preference({ organizationId: ORG_B, propertyId: PROPERTY_B, enabled: true }),
    )

    expect(await resolve(PERSON, ORG_A, PROPERTY_A)).toMatchObject({ enabled: false })
    expect(await resolve(PERSON, ORG_B, PROPERTY_B)).toMatchObject({ enabled: true })
  })

  it('lists only the account asked for, and only that person’s rows', async () => {
    await store.upsert(db, preference({ userId: COLLEAGUE, cadence: 'daily' }))

    const mine = await store.findByUser(db, PERSON, ORG_A)
    const theirs = await store.findByUser(db, COLLEAGUE, ORG_A)
    const elsewhere = await store.findByUser(db, PERSON, ORG_B)

    expect(mine.map((row) => [row.userId, row.organizationId])).toEqual([[PERSON, ORG_A]])
    expect(theirs.map((row) => [row.userId, row.organizationId])).toEqual([
      [COLLEAGUE, ORG_A],
    ])
    expect(elsewhere.map((row) => [row.userId, row.organizationId])).toEqual([
      [PERSON, ORG_B],
    ])
  })

  it('keeps a category default in the account it was saved in', async () => {
    await store.saveCategoryDefault(
      db,
      categoryDefault({ category: 'arrivals', cadence: 'immediate' }),
      PROPERTY_A,
    )

    const inA = await store.findCategoryDefaults(db, PERSON, ORG_A)
    const inB = await store.findCategoryDefaults(db, PERSON, ORG_B)

    expect(inA).toContainEqual(
      expect.objectContaining({ category: 'arrivals', cadence: 'immediate' }),
    )
    expect(inB.map((row) => row.category)).not.toContain('arrivals')
  })

  it('applies a quiet window to its own account only', async () => {
    const settings = {
      locale: 'en',
      timezone: 'Europe/Sofia',
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      urgentBypassEnabled: true,
      createdAt: AT,
      updatedAt: AT,
    }
    await store.upsertUserSettings(db, {
      ...settings,
      userId: PERSON,
      organizationId: ORG_A,
    })

    expect(await store.resolveDeliveryWindow(db, PERSON, ORG_A, PROPERTY_A)).toEqual({
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      urgentBypassEnabled: true,
    })
    expect(await store.resolveDeliveryWindow(db, PERSON, ORG_B, PROPERTY_B)).toEqual({
      quietHoursStart: null,
      quietHoursEnd: null,
      urgentBypassEnabled: false,
    })
  })

  it('applies a Property override to that Property’s account and leaves the person’s other account on its own window', async () => {
    await store.upsertPropertyDeliveryWindow(db, {
      userId: PERSON,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      quietHoursStart: null,
      quietHoursEnd: null,
      urgentBypassEnabled: false,
      createdAt: AT,
      updatedAt: AT,
    })

    expect(await store.resolveDeliveryWindow(db, PERSON, ORG_A, PROPERTY_A)).toEqual({
      quietHoursStart: null,
      quietHoursEnd: null,
      urgentBypassEnabled: false,
    })
    expect(await store.findPropertyDeliveryWindows(db, PERSON, ORG_B)).toEqual([])
    expect(await store.findPropertyDeliveryWindows(db, COLLEAGUE, ORG_A)).toEqual([])
  })
})
