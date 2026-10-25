import { describe, expect, it } from 'vitest'
import { downloadPortalPrintFinalInputSchema } from './portal-print-final.dto'

const valid = {
  portalId: 'p-1',
  piece: 'tent',
  orientation: 'wide',
  look: 'paper',
  printer: 'my_printer',
  quantity: 8,
  languages: ['en', 'es'],
  callToAction: 'rate',
}

const parse = (extra: object) =>
  downloadPortalPrintFinalInputSchema.safeParse({ ...valid, ...extra })

describe('downloadPortalPrintFinalInputSchema', () => {
  it('accepts a piece in one or two languages', () => {
    expect(parse({}).success).toBe(true)
    expect(parse({ languages: ['bg'] }).success).toBe(true)
  })

  it('takes every piece, orientation, look and printer the kit names', () => {
    for (const piece of ['counter', 'tent', 'small']) {
      expect(parse({ piece }).success).toBe(true)
    }
    for (const orientation of ['upright', 'wide']) {
      expect(parse({ orientation }).success).toBe(true)
    }
    for (const look of ['paper', 'immersive']) {
      expect(parse({ look }).success).toBe(true)
    }
    for (const printer of ['my_printer', 'print_shop']) {
      expect(parse({ printer }).success).toBe(true)
    }
  })

  it('refuses the words the kit retired', () => {
    expect(parse({ piece: 'table_tent' }).success).toBe(false)
    expect(parse({ orientation: 'portrait' }).success).toBe(false)
    expect(parse({ printer: 'output' }).success).toBe(false)
  })

  it('leaves the paper to the Property’s country unless the request names one', () => {
    expect(parse({}).data?.paper).toBeUndefined()
    expect(parse({ paper: 'a4' }).data?.paper).toBe('a4')
    expect(parse({ paper: 'tabloid' }).success).toBe(false)
  })

  it('keeps the spares off unless the request asks for them', () => {
    expect(parse({}).data?.fillSpares).toBe(false)
    expect(parse({ fillSpares: true }).data?.fillSpares).toBe(true)
  })

  it('takes a whole number of pieces from one up to the most a print makes', () => {
    expect(parse({ quantity: 1 }).success).toBe(true)
    expect(parse({ quantity: 1000 }).success).toBe(true)
    expect(parse({ quantity: 0 }).success).toBe(false)
    expect(parse({ quantity: 1001 }).success).toBe(false)
    expect(parse({ quantity: 2.5 }).success).toBe(false)
  })

  it('takes a count a sheet of one or more', () => {
    expect(parse({ perSheet: 4 }).data?.perSheet).toBe(4)
    expect(parse({ perSheet: 0 }).success).toBe(false)
  })

  it('refuses no language, a third language and the same language twice', () => {
    expect(parse({ languages: [] }).success).toBe(false)
    expect(parse({ languages: ['en', 'es', 'bg'] }).success).toBe(false)
    expect(parse({ languages: ['en', 'en'] }).success).toBe(false)
  })

  it('refuses an empty Portal id and an unknown call to action', () => {
    expect(parse({ portalId: '' }).success).toBe(false)
    expect(parse({ callToAction: 'buy' }).success).toBe(false)
  })
})
