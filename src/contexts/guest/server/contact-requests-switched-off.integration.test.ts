// With the contact-request switch off (its default), the manager endpoints
// answer like a missing request before identity or permission is consulted.

import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { getContactRequestFn, revealContactRequestFn } from './contact-requests'

const harness = setupServerFunctionHarness({
  cleanupTables: ['guest_contact_request_reveal_audits'],
})

const UNAVAILABLE = { status: 404, code: 'unavailable' }

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const member = await harness.seedMember(organization, 'Member')
  const property = await harness.seedProperty(organization)
  const portal = await harness.seedPortal(property)
  return { organization, admin, member, property, portal }
}

describe('contact request manager endpoints with the switch off', () => {
  it.each(['AccountAdmin', 'Member', 'nobody'] as const)(
    'answers a read from %s as unavailable, not as a permission refusal',
    async (who) => {
      const h = await hotel()
      const caller = who === 'AccountAdmin' ? h.admin : who === 'Member' ? h.member : null

      await expect(
        harness.callAs(caller, () =>
          getContactRequestFn({
            data: {
              propertyId: h.property.id,
              portalId: h.portal.id,
              responseId: randomUUID(),
            },
          }),
        ),
      ).rejects.toMatchObject(UNAVAILABLE)
    },
  )

  it.each(['AccountAdmin', 'Member', 'nobody'] as const)(
    'answers a reveal from %s as unavailable and writes no audit row',
    async (who) => {
      const h = await hotel()
      const caller = who === 'AccountAdmin' ? h.admin : who === 'Member' ? h.member : null

      await expect(
        harness.callAs(caller, () =>
          revealContactRequestFn({
            data: {
              propertyId: h.property.id,
              portalId: h.portal.id,
              contactRequestId: randomUUID(),
            },
          }),
        ),
      ).rejects.toMatchObject(UNAVAILABLE)
      const { rows } = await harness
        .pool()
        .query(
          'SELECT 1 FROM guest_contact_request_reveal_audits WHERE organization_id = $1',
          [h.organization.id],
        )
      expect(rows).toEqual([])
    },
  )
})
