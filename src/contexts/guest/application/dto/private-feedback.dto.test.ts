import { describe, expect, it } from 'vitest'
import {
  PRIVATE_FEEDBACK_MAX_LENGTH,
  privateFeedbackTextSchema,
} from './private-feedback.dto'

describe('privateFeedbackTextSchema', () => {
  it('normalizes line endings and preserves paragraphs at the application boundary', () => {
    expect(
      privateFeedbackTextSchema.parse(
        '  First line\r\nsecond line\r\r\nThird paragraph  ',
      ),
    ).toBe('First line\nsecond line\n\nThird paragraph')
  })

  it('exposes the maximum the schema enforces, for forms that mirror it', () => {
    const at = '😀'.repeat(PRIVATE_FEEDBACK_MAX_LENGTH)
    expect(privateFeedbackTextSchema.safeParse(at).success).toBe(true)
    expect(privateFeedbackTextSchema.safeParse(`${at}😀`).success).toBe(false)
  })

  it('uses Unicode code points for the 2000-character boundary', () => {
    expect(privateFeedbackTextSchema.safeParse('😀'.repeat(2000)).success).toBe(true)
    expect(privateFeedbackTextSchema.safeParse('😀'.repeat(2001)).success).toBe(false)
  })
})
