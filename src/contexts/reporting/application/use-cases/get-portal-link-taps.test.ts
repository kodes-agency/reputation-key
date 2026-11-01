import { expect, it, vi } from 'vitest'
import { getPortalLinkTaps } from './get-portal-link-taps'
import { asAccountAdmin } from '#/shared/testing/authorized-reads'
import { organizationId, propertyId, portalId } from '#/shared/domain/ids'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
const input = {
  organizationId: organizationId('org-taps'),
  propertyId: propertyId('a0000000-0000-4000-8000-000000000001'),
  portalId: portalId('b0000000-0000-4000-8000-000000000001'),
  startDate: new Date('2026-10-03T21:00:00Z'),
  endDate: new Date('2026-11-01T10:00:00Z'),
}
it('uses the same governed repository over the supplied 30 local day window', async () => {
  const getPortalLinkTapCounts = vi.fn(async () => [{ linkId: 'menu', taps: 96 }])
  const read = asAccountAdmin(
    getPortalLinkTaps({
      portalMetrics: { getPortalLinkTapCounts },
      propertyAccess: async () => null,
    }),
  )
  expect(await read(input)).toEqual({ windowDays: 30, taps: { menu: 96 } })
  expect(getPortalLinkTapCounts).toHaveBeenCalledWith({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    portalId: input.portalId,
    startAt: input.startDate,
    endAt: input.endDate,
  })
})
it('refuses a reader without dashboard access before reading counts', async () => {
  const getPortalLinkTapCounts = vi.fn(async () => [])
  const read = getPortalLinkTaps({
    portalMetrics: { getPortalLinkTapCounts },
    propertyAccess: async () => [],
  })
  await expect(
    read(
      input,
      buildTestAuthContext({
        organizationId: input.organizationId,
        role: 'PropertyManager',
      }),
    ),
  ).rejects.toMatchObject({ code: 'forbidden' })
  expect(getPortalLinkTapCounts).not.toHaveBeenCalled()
})
