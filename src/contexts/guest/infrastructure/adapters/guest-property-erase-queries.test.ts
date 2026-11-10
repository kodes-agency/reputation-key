import { expect, it } from 'vitest'
import type { Tx } from '#/shared/outbox/commit'
import { createGuestPropertyEraseContributor } from './guest-property-erase.adapter'

it('counts Guest inventory tables sequentially on the lent transaction', async () => {
  let active = 0
  let peak = 0
  const tx = {
    execute: async () => {
      active++
      peak = Math.max(peak, active)
      await Promise.resolve()
      active--
      return { rows: [{ rows: 7 }] }
    },
  } as unknown as Tx

  const inventory = await createGuestPropertyEraseContributor().inventory(tx, {
    organizationId: 'org',
    propertyId: '11111111-1111-4111-8111-111111111111',
  })

  expect(inventory.length).toBeGreaterThan(1)
  expect(
    inventory.every((entry) => entry.context === 'guest' && entry.rowCount === 7),
  ).toBe(true)
  expect(peak).toBe(1)
})
