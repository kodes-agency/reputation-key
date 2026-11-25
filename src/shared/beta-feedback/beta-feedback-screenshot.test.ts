import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod/v4'
import { maskedLayoutSchema, MASKED_LAYOUT_MAX_BOXES } from './beta-feedback-layout'
import {
  BETA_FEEDBACK_SCREENSHOT_MAX_BYTES,
  betaFeedbackScreenshotSchema,
  describeBetaFeedbackScreenshot,
  screenshotBytes,
} from './beta-feedback-screenshot'

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG = [0xff, 0xd8, 0xff, 0xe0]
const WEBP = [...'RIFF'].map((c) => c.charCodeAt(0)).concat([0x24, 0, 0, 0])
WEBP.push(...[...'WEBPVP8 '].map((c) => c.charCodeAt(0)))

/** Base64 of a file that starts with `signature` and is `size` bytes long. */
function imageBase64(signature: readonly number[], size = 64): string {
  const bytes = new Uint8Array(size)
  bytes.set(signature)
  return Buffer.from(bytes).toString('base64')
}

/** The default REQUEST_BODY_LIMIT_BYTES (src/shared/config/env.ts). */
const DEFAULT_REQUEST_BODY_LIMIT_BYTES = 1_048_576

describe('beta feedback screenshot', () => {
  it.each([
    ['image/png', PNG],
    ['image/jpeg', JPEG],
    ['image/webp', WEBP],
  ] as const)('accepts %s bytes that start the way that type does', (mediaType, sig) => {
    const screenshot = { mediaType, base64: imageBase64(sig) }
    expect(betaFeedbackScreenshotSchema.parse(screenshot)).toEqual(screenshot)
  })

  it.each([
    ['image/webp', PNG],
    ['image/png', JPEG],
    ['image/jpeg', [...'<html><script>'].map((c) => c.charCodeAt(0))],
  ] as const)('refuses %s bytes that start like something else', (mediaType, sig) => {
    expect(() =>
      betaFeedbackScreenshotSchema.parse({ mediaType, base64: imageBase64(sig) }),
    ).toThrow(ZodError)
  })

  it('refuses an image over the size the request limit leaves room for', () => {
    const atLimit = imageBase64(PNG, BETA_FEEDBACK_SCREENSHOT_MAX_BYTES)
    const overLimit = imageBase64(PNG, BETA_FEEDBACK_SCREENSHOT_MAX_BYTES + 3)

    expect(
      betaFeedbackScreenshotSchema.safeParse({ mediaType: 'image/png', base64: atLimit })
        .success,
    ).toBe(true)
    expect(() =>
      betaFeedbackScreenshotSchema.parse({ mediaType: 'image/png', base64: overLimit }),
    ).toThrow(ZodError)
  })

  it.each([
    ['a data URL', `data:image/png;base64,${imageBase64(PNG)}`],
    ['text that is not base64', 'not base64 at all!'],
    ['base64 cut short', imageBase64(PNG).slice(0, -1)],
  ])('refuses %s', (_name, base64) => {
    expect(() =>
      betaFeedbackScreenshotSchema.parse({ mediaType: 'image/png', base64 }),
    ).toThrow(ZodError)
  })

  it.each(['image/svg+xml', 'image/gif', 'text/html'])(
    'refuses the %s media type',
    (mediaType) => {
      expect(() =>
        betaFeedbackScreenshotSchema.parse({ mediaType, base64: imageBase64(PNG) }),
      ).toThrow(ZodError)
    },
  )

  it('refuses a field the contract does not name', () => {
    expect(() =>
      betaFeedbackScreenshotSchema.parse({
        mediaType: 'image/png',
        base64: imageBase64(PNG),
        filename: 'guest-list.png',
      }),
    ).toThrow(ZodError)
  })

  it('counts the decoded bytes and describes them for triage', () => {
    const screenshot = {
      mediaType: 'image/webp',
      base64: imageBase64(WEBP, 2_050),
    } as const

    expect(screenshotBytes(screenshot.base64)).toBe(2_050)
    expect(describeBetaFeedbackScreenshot(screenshot)).toBe('image/webp, 2 KB')
  })

  it('keeps the largest possible report under the default request limit', () => {
    // A screenshot travels as base64 inside the JSON report, so the cap is
    // what lets the whole report, at every field's maximum, fit under the
    // limit the request guard enforces before any route runs. Text fields are
    // counted at six bytes a character, the worst escape the wire can apply.
    const largestScreenshot = imageBase64(PNG, BETA_FEEDBACK_SCREENSHOT_MAX_BYTES)
    const largestLayout = maskedLayoutSchema.parse({
      width: 20_000,
      height: 20_000,
      boxes: Array.from({ length: MASKED_LAYOUT_MAX_BOXES }, () => ({
        x: -20_000,
        y: -20_000,
        w: 20_000,
        h: 20_000,
        role: 'container',
      })),
    })
    const worstCaseTextBytes = 6 * (6_000 + 2_048)
    const framingAllowance = 16 * 1024

    expect(
      largestScreenshot.length +
        JSON.stringify(largestLayout).length +
        worstCaseTextBytes +
        framingAllowance,
    ).toBeLessThan(DEFAULT_REQUEST_BODY_LIMIT_BYTES)
  })
})
