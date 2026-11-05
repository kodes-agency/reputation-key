import { describe, expect, it } from 'vitest'
import {
  AI_REDACTION_PROFILE_DIGEST,
  AI_REDACTION_PROFILE_VERSION,
  redactAiReviewText,
} from './ai-deterministic-redactor'
import {
  AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
  AI_STRUCTURED_MARKER_DETECTORS_VERSION,
} from './ai-structured-marker-detectors'

describe('whole URL redaction', () => {
  const prefix =
    'The room was clean and quiet, breakfast was fresh and the staff were kind. Please visit '
  it.each([
    'https://guest:opensesame@example.com/booking/private-code?ref=private#details',
    'https://guest@example.com/booking/private-code',
    'http://192.0.2.55:8080/booking/private-code?ref=private#details',
    'https://[2001:db8::1]/booking/private-code?ref=private#details',
    'https://guest:opensesame@[2001:db8::1]/booking/private-code',
    'http://guest:opensesame@192.0.2.55/booking/private-code',
    'https://guest:opensesame@localhost/booking/private-code',
    'https://[2001:db8::1]',
    'https://guest:opensesame@[2001:db8::1]',
  ])('removes credentials, host, path, query and fragment together: %s', (url) => {
    expect(
      redactAiReviewText({
        text: `${prefix}${url}. Thank you.`,
        countryCode: 'US',
        expectedRedactionProfileVersion: AI_REDACTION_PROFILE_VERSION,
        expectedRedactionProfileDigest: AI_REDACTION_PROFILE_DIGEST,
        expectedDetectorProfileVersion: AI_STRUCTURED_MARKER_DETECTORS_VERSION,
        expectedDetectorProfileDigest: AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
      }),
    ).toMatchObject({
      status: 'redacted',
      text: `${prefix}[CONTACT]. Thank you.`,
    })
  })
})
