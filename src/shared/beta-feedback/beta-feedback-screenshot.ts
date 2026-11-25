// Beta feedback screenshot — the one image a reporter may attach to a report.
//
// The reporter pastes or picks any image. The browser shrinks and re-encodes
// it (`beta-feedback-screenshot-encode.ts`), which also drops its metadata, so
// the whole report fits the server's default request limit. It travels as
// base64 inside the JSON report and reaches monitoring as an attachment of the
// feedback event, never the triage table and never the public tracker.
//
// The server cannot see the pixels and does not decode them. What it does
// check is that the bytes start the way the declared type does, so nothing but
// an image is ever sent to monitoring under an image's name.

import { z } from 'zod/v4'

export const BETA_FEEDBACK_SCREENSHOT_TYPES = [
  'image/webp',
  'image/jpeg',
  'image/png',
] as const
export type BetaFeedbackScreenshotType = (typeof BETA_FEEDBACK_SCREENSHOT_TYPES)[number]

/**
 * The largest encoded image accepted. The report must stay under the default
 * 1 MiB request limit (`REQUEST_BODY_LIMIT_BYTES`), and base64 adds a third;
 * 640 KiB leaves room for the longest text and the largest masked layout.
 */
export const BETA_FEEDBACK_SCREENSHOT_MAX_BYTES = 640 * 1024
const MAX_BASE64_LENGTH = Math.ceil(BETA_FEEDBACK_SCREENSHOT_MAX_BYTES / 3) * 4

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u
/** Twelve bytes is enough to tell all three formats apart. */
const SIGNATURE_BASE64_CHARS = 16

const ascii = (bytes: Uint8Array, start: number, end: number): string =>
  String.fromCharCode(...bytes.subarray(start, end))

const SIGNATURES: Readonly<
  Record<BetaFeedbackScreenshotType, (bytes: Uint8Array) => boolean>
> = {
  'image/png': (bytes) =>
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (value, index) => bytes[index] === value,
    ),
  'image/jpeg': (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  'image/webp': (bytes) =>
    ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP',
}

function leadingBytes(base64: string): Uint8Array {
  const binary = atob(base64.slice(0, SIGNATURE_BASE64_CHARS))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

/** The decoded size of a well-formed base64 string. */
export function screenshotBytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return (base64.length / 4) * 3 - padding
}

export const betaFeedbackScreenshotSchema = z
  .object({
    mediaType: z.enum(BETA_FEEDBACK_SCREENSHOT_TYPES),
    base64: z
      .string()
      .min(SIGNATURE_BASE64_CHARS)
      .max(MAX_BASE64_LENGTH, 'The screenshot is too large to send.')
      .regex(BASE64, 'The screenshot could not be read.')
      .refine((base64) => base64.length % 4 === 0, 'The screenshot could not be read.'),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.base64.length % 4 !== 0 || !BASE64.test(value.base64)) return
    if (screenshotBytes(value.base64) > BETA_FEEDBACK_SCREENSHOT_MAX_BYTES) {
      ctx.addIssue({
        code: 'custom',
        path: ['base64'],
        message: 'The screenshot is too large to send.',
      })
    }
    if (!SIGNATURES[value.mediaType](leadingBytes(value.base64))) {
      ctx.addIssue({
        code: 'custom',
        path: ['base64'],
        message: 'The screenshot is not the kind of image it says it is.',
      })
    }
  })

export type BetaFeedbackScreenshot = z.infer<typeof betaFeedbackScreenshotSchema>

/** A content-free line for the report text, so triage knows to open it. */
export function describeBetaFeedbackScreenshot(
  screenshot: BetaFeedbackScreenshot,
): string {
  const kilobytes = Math.max(1, Math.round(screenshotBytes(screenshot.base64) / 1024))
  return `${screenshot.mediaType}, ${kilobytes} KB`
}
