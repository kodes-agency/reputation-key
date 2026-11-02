import { it, expect, vi } from 'vitest'
import type { Tx } from '#/shared/outbox/commit'
import type { UpdatePortalCommand } from '../application/ports/portal-command-store.port'
import { assertStaffScanSwitch } from './staff-scan-switch-guard'
const command = (skipPrivateRating: boolean) =>
  ({
    organizationId: 'org',
    propertyId: 'p',
    portalId: 'portal',
    revision: new Date('2026-11-01T12:00:00Z'),
    patch: { skipPrivateRating },
  }) as UpdatePortalCommand
it('takes no target lock when turning skip off', async () => {
  const execute = vi.fn()
  await assertStaffScanSwitch({ execute } as unknown as Tx, command(false))
  expect(execute).not.toHaveBeenCalled()
})
it('refuses a concurrent staff target after acquiring the shared property fence', async () => {
  const execute = vi
    .fn()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 'target' }] })
  await expect(
    assertStaffScanSwitch({ execute } as unknown as Tx, command(true)),
  ).rejects.toMatchObject({
    code: 'running_rating_goal',
    message: 'This portal has a running scan target for staff. End the target first.',
  })
  expect(execute).toHaveBeenCalledTimes(2)
})
