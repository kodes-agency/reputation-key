// Every settling route, dispatched from its real producer over PostgreSQL: the
// notices that asked for the work are retired, the mail queued behind them is
// cancelled, and nothing outside the route's type, resource, Property or
// Organization is touched.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import {
  createDelayedExecutionPolicy,
  initDelayedExecutionPolicy,
  resetDelayedExecutionPolicy,
} from '#/shared/auth/system-execution-policy'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  ITEM,
  ORG,
  PRODUCED_FACTS,
  PROPERTY,
  SETTLED_RESOURCE,
  SETTLING_FACTS,
} from '#/shared/testing/notification-route-producer-fixtures'
import {
  currentRouteDeps,
  dispatch,
} from '#/shared/testing/notification-route-test-harness'
import { BETA_NOTIFICATION_TRIGGER_MATRIX } from '../application/beta-notification-trigger-matrix'
import { seedProperty } from '#/shared/db/testing/notification-test-db'
import { seedNotice } from './jobs/delivery-seed'
import {
  MAIL_CANCELLED,
  MAIL_QUEUED,
  queuedMail,
  settledAt,
} from './notification-settlement-test-db'

const OTHER_PROPERTY = '4d1f0c1e-2b7a-4c55-9a51-0000000000f1'
const OTHER_ORG_PROPERTY = '4d1f0c1e-2b7a-4c55-9a51-0000000000f2'
const OTHER_ORG = 'org-route-contract-other'
const OTHER_RESOURCE = 'resource-not-settled'
const RECIPIENT = 'recipient-route-settlement'
const OTHER_PROPERTY_RECIPIENT = 'other-property-recipient-route-settlement'
const OTHER_RECIPIENT = 'other-recipient-route-settlement'
const CREATED_AT = new Date('2026-09-24T07:00:00.000Z')

describe.sequential('settling routes retire their notices and cancel their mail', () => {
  let held: HeldTransaction

  beforeAll(async () => {
    registerAllEventSchemas()
    held = await holdTransaction()
    await seedProperty(held.db, { id: PROPERTY, organizationId: ORG })
    await seedProperty(held.db, { id: OTHER_PROPERTY, organizationId: ORG })
    await seedProperty(held.db, { id: OTHER_ORG_PROPERTY, organizationId: OTHER_ORG })
  })

  beforeEach(() => {
    initCapabilityPolicyStore(createEnvCapabilityPolicyStore({}))
    initDelayedExecutionPolicy(
      createDelayedExecutionPolicy({ refreshPolicy: async () => {} }),
    )
  })

  afterEach(() => {
    resetDelayedExecutionPolicy()
    resetCapabilityPolicyStore()
  })

  afterAll(async () => {
    await held?.rollBack()
  })

  for (const route of BETA_NOTIFICATION_TRIGGER_MATRIX.filter(
    (candidate) => candidate.settles !== undefined,
  )) {
    it(`${route.eventType}: ${route.consumerName} settles only what it is scoped to`, async () => {
      const types = route.settles ?? []
      const isPropertyWide = route.eventType === 'property.archived'
      const resourceId = SETTLED_RESOURCE[route.eventType] ?? ITEM
      const seed = (
        name: string,
        input: Readonly<{
          type: string
          organizationId?: string
          propertyId?: string
          resourceId?: string
          userId?: string
        }>,
      ) =>
        seedNotice(held.db, {
          name: `${route.consumerName}:${name}`,
          organizationId: input.organizationId ?? ORG,
          userId: `${input.userId ?? RECIPIENT}:${route.consumerName}`,
          propertyId: input.propertyId ?? PROPERTY,
          createdAt: CREATED_AT,
          type: input.type,
          resourceType: 'inbox_item',
          resourceId: input.resourceId ?? resourceId,
        })
      const name = (suffix: string) => `${route.consumerName}:${suffix}`

      for (const type of types) await seed(type, { type })
      await seed('other-organization', {
        type: types[0]!,
        organizationId: OTHER_ORG,
        propertyId: OTHER_ORG_PROPERTY,
        userId: OTHER_RECIPIENT,
      })
      await seed(
        isPropertyWide ? 'other-property' : 'other-resource',
        isPropertyWide
          ? {
              type: types[0]!,
              propertyId: OTHER_PROPERTY,
              userId: OTHER_PROPERTY_RECIPIENT,
            }
          : { type: types[0]!, resourceId: OTHER_RESOURCE },
      )
      await seed('other-type', { type: 'account.invitation_accepted' })

      const { envelope, receipts, gateDenials, queued } = await dispatch(
        (SETTLING_FACTS[route.consumerName] ?? PRODUCED_FACTS[route.eventType])!(),
        currentRouteDeps(held.db),
      )

      // A settling route announces nothing.
      expect(gateDenials).toEqual([])
      expect(queued.filter((job) => types.includes(job.type))).toEqual([])
      expect(receipts).toContainEqual({
        eventId: envelope.eventId,
        consumerName: route.consumerName,
        status: 'applied',
      })
      for (const type of types) {
        expect(await settledAt(held.db, name(type)), type).not.toBeNull()
        expect(await queuedMail(held.db, name(type)), type).toEqual(MAIL_CANCELLED)
      }
      const untouched = [
        'other-organization',
        isPropertyWide ? 'other-property' : 'other-resource',
        'other-type',
      ]
      for (const control of untouched) {
        expect(await settledAt(held.db, name(control)), control).toBeNull()
        expect(await queuedMail(held.db, name(control)), control).toEqual(MAIL_QUEUED)
      }
    })
  }
})
