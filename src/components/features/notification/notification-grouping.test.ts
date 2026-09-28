// /notifications groups rows by Property. Rows without one belong to the
// Organization, and not all of them are about access: a disconnected Google
// account or a beta report's outcome is Organization work, not security.

import { describe, expect, it } from 'vitest'
import { makeNotification } from './notification.stories.fixtures'
import { groupByProperty } from './notification-filters'

const roleChanged = makeNotification({
  id: '30000000-0000-4000-8000-000000000001',
  type: 'account.organization_role_changed',
  propertyId: null,
})
const googleDisconnected = makeNotification({
  id: '30000000-0000-4000-8000-000000000002',
  type: 'integration.google_disconnected',
  propertyId: null,
})
const reportOutcome = makeNotification({
  id: '30000000-0000-4000-8000-000000000003',
  type: 'beta_feedback.outcome',
  propertyId: null,
})

const labelled = (rows: Parameters<typeof groupByProperty>[0]) =>
  groupByProperty(rows, {}).map((group) => [
    group.label,
    group.notifications.map((row) => row.id),
  ])

describe('Organization rows on the notifications page', () => {
  it('keeps access notices apart from other Organization notices', () => {
    expect(labelled([googleDisconnected, roleChanged, reportOutcome])).toEqual([
      ['Organization', [googleDisconnected.id, reportOutcome.id]],
      ['Account and security', [roleChanged.id]],
    ])
  })
})
