import { describe, expect, it } from 'vitest'
import { LINING_FIGURES } from './print-kit-art-layout'

describe('LINING_FIGURES', () => {
  it('asks for the lnum feature by its tag, so no utility class is generated for it', () => {
    expect(LINING_FIGURES).toEqual({ fontFeatureSettings: '"lnum" 1' })
  })
})
