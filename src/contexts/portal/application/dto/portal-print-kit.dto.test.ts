import { describe, expect, it } from 'vitest'
import {
  downloadPortalPrintKitInputSchema,
  portalPrintKitInputSchema,
} from './portal-print-kit.dto'

const valid = {
  portalId: 'p-1',
  piece: 'table_tent',
  languages: ['en', 'bg'],
  callToAction: 'rate',
}

describe('portalPrintKitInputSchema', () => {
  it('takes a Portal id and refuses an empty one', () => {
    expect(portalPrintKitInputSchema.safeParse({ portalId: 'p-1' }).success).toBe(true)
    expect(portalPrintKitInputSchema.safeParse({ portalId: '' }).success).toBe(false)
  })
})

describe('downloadPortalPrintKitInputSchema', () => {
  it('accepts a piece in one or two languages', () => {
    expect(downloadPortalPrintKitInputSchema.safeParse(valid).success).toBe(true)
    expect(
      downloadPortalPrintKitInputSchema.safeParse({ ...valid, languages: ['bg'] })
        .success,
    ).toBe(true)
  })

  it.each([
    ['a piece the kit does not have', { piece: 'poster' }],
    ['no language', { languages: [] }],
    ['three languages', { languages: ['en', 'bg', 'es'] }],
    ['the same language twice', { languages: ['en', 'en'] }],
    ['a language the catalogue lacks', { languages: ['xx'] }],
    ['a call to action it does not have', { callToAction: 'stay' }],
    ['an empty Portal id', { portalId: '' }],
  ])('refuses %s', (_label, override) => {
    expect(
      downloadPortalPrintKitInputSchema.safeParse({ ...valid, ...override }).success,
    ).toBe(false)
  })
})
