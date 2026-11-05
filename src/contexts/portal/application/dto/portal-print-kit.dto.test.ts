import { describe, expect, it } from 'vitest'
import { portalPrintKitInputSchema } from './portal-print-kit.dto'

describe('portalPrintKitInputSchema', () => {
  it('takes a Portal id and refuses an empty one', () => {
    expect(portalPrintKitInputSchema.safeParse({ portalId: 'p-1' }).success).toBe(true)
    expect(portalPrintKitInputSchema.safeParse({ portalId: '' }).success).toBe(false)
  })
})
