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

  it('accepts the Paper style, with a paper or without one', () => {
    const parse = (extra: object) =>
      downloadPortalPrintKitInputSchema.safeParse({ ...valid, ...extra })
    expect(parse({ style: 'paper', paper: 'letter' }).data).toMatchObject({
      style: 'paper',
      paper: 'letter',
    })
    expect(parse({ style: 'paper', paper: 'a4' }).success).toBe(true)
    expect(parse({ style: 'paper' }).data?.paper).toBeUndefined()
  })

  it('accepts the Immersive style, its paper naming the size family', () => {
    const parse = (extra: object) =>
      downloadPortalPrintKitInputSchema.safeParse({ ...valid, ...extra })
    expect(parse({ style: 'immersive', paper: 'letter' }).data).toMatchObject({
      style: 'immersive',
      paper: 'letter',
    })
    expect(parse({ style: 'immersive', paper: 'a4' }).success).toBe(true)
    expect(parse({ style: 'immersive' }).data?.paper).toBeUndefined()
  })

  it('makes a request that names no style a Paper request', () => {
    const parsed = downloadPortalPrintKitInputSchema.parse(valid)
    expect(parsed.style).toBe('paper')
    expect(parsed.paper).toBeUndefined()
  })

  it('prints the property’s name under the logo unless the request says not to', () => {
    const parse = (extra: object) =>
      downloadPortalPrintKitInputSchema.safeParse({ ...valid, ...extra })
    expect(parse({}).data?.showPropertyName).toBe(true)
    expect(parse({ showPropertyName: false }).data?.showPropertyName).toBe(false)
    expect(parse({ showPropertyName: 'no' }).success).toBe(false)
  })

  it.each([
    ['a piece the kit does not have', { piece: 'poster' }],
    ['no language', { languages: [] }],
    ['three languages', { languages: ['en', 'bg', 'es'] }],
    ['the same language twice', { languages: ['en', 'en'] }],
    ['a language the catalogue lacks', { languages: ['xx'] }],
    ['a call to action it does not have', { callToAction: 'stay' }],
    ['an empty Portal id', { portalId: '' }],
    ['a style the kit does not have', { style: 'poster' }],
    ['a paper the kit does not print on', { style: 'paper', paper: 'legal' }],
  ])('refuses %s', (_label, override) => {
    expect(
      downloadPortalPrintKitInputSchema.safeParse({ ...valid, ...override }).success,
    ).toBe(false)
  })
})
