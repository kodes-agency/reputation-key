import { describe, expect, it } from 'vitest'
import { printKitFontBytes } from './print-kit-fonts'

describe('printKitFontBytes', () => {
  it('hands back the same bytes each time', () => {
    expect(printKitFontBytes('display', 'cyrillic')).toBe(
      printKitFontBytes('display', 'cyrillic'),
    )
  })
})
