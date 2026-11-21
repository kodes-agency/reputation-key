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

function redact(text: string, countryCode: string) {
  return redactAiReviewText({
    text,
    countryCode,
    expectedRedactionProfileVersion: AI_REDACTION_PROFILE_VERSION,
    expectedRedactionProfileDigest: AI_REDACTION_PROFILE_DIGEST,
    expectedDetectorProfileVersion: AI_STRUCTURED_MARKER_DETECTORS_VERSION,
    expectedDetectorProfileDigest: AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
  })
}

function financialCount(text: string, countryCode: string): number {
  const result = redact(text, countryCode)
  return result.status === 'redacted' ? result.counts['[FINANCIAL]'] : -1
}

// The IBAN pattern is greedy: the words after an IBAN joined its match, the
// checksum failed on the longer string, and the IBAN reached the provider.
describe('an IBAN followed by words', () => {
  it.each([
    {
      label: 'one word',
      text: 'Please refund the deposit to BG80 BNBG 9661 1020 3456 78 please.',
      countryCode: 'BG',
      expected: 'Please refund the deposit to [FINANCIAL] please.',
    },
    {
      label: 'two words',
      text: 'Please refund the deposit to BG80 BNBG 9661 1020 3456 78 thank you.',
      countryCode: 'BG',
      expected: 'Please refund the deposit to [FINANCIAL] thank you.',
    },
    {
      label: 'three words',
      text: 'near BG80 BNBG 9661 1020 3456 78 near the beach.',
      countryCode: 'BG',
      expected: 'near [FINANCIAL] near the beach.',
    },
    {
      label: 'five words',
      text: 'Please refund the deposit to BG80 BNBG 9661 1020 3456 78 before we check out tomorrow.',
      countryCode: 'BG',
      expected: 'Please refund the deposit to [FINANCIAL] before we check out tomorrow.',
    },
    {
      label: 'lower case',
      text: 'please refund the deposit to bg80 bnbg 9661 1020 3456 78 please.',
      countryCode: 'BG',
      expected: 'please refund the deposit to [FINANCIAL] please.',
    },
    {
      label: 'hyphens',
      text: 'Please refund the deposit to GB82-WEST-1234-5698-7654-32 please.',
      countryCode: 'GB',
      expected: 'Please refund the deposit to [FINANCIAL] please.',
    },
    {
      label: 'no spaces',
      text: 'Please refund the deposit to BG80BNBG96611020345678 please.',
      countryCode: 'BG',
      expected: 'Please refund the deposit to [FINANCIAL] please.',
    },
  ])('replaces only the IBAN with $label after it', ({ text, countryCode, expected }) => {
    expect(redact(text, countryCode)).toMatchObject({
      status: 'redacted',
      text: expected,
      counts: { '[FINANCIAL]': 1 },
    })
  })

  it('reads an IBAN that follows a word shaped like an IBAN start', () => {
    expect(
      redact('Please send the refund for room AB12 NO93 8601 1117 947 today.', 'NO'),
    ).toMatchObject({
      status: 'redacted',
      text: 'Please send the refund for room AB12 [FINANCIAL] today.',
    })
  })

  it('reads a second IBAN in the same run of groups', () => {
    expect(
      redact(
        'Please split the refund between NO93 8601 1117 947 NO93 8601 1117 947 please, thank you.',
        'NO',
      ),
    ).toMatchObject({
      status: 'redacted',
      text: 'Please split the refund between [FINANCIAL] [FINANCIAL] please, thank you.',
      counts: { '[FINANCIAL]': 2 },
    })
  })

  it('still fails closed on an over-long IBAN-shaped run after a valid IBAN', () => {
    expect(
      redact(
        'Please refund the deposit to BG80 BNBG 9661 1020 3456 78 XX12 3456 7890 1234 5678 9012 3456 7890 1234 thanks.',
        'BG',
      ),
    ).toEqual({ status: 'redaction_blocked', reason: 'ambiguous_candidate' })
  })

  it('still fails closed on an over-long run with no group boundary', () => {
    expect(
      redact(
        'Please refund the deposit to BG80BNBG96611020345678ANDTHENSOMEMORE please, thank you.',
        'BG',
      ),
    ).toEqual({ status: 'redaction_blocked', reason: 'ambiguous_candidate' })
  })
})

describe('prose with a word shaped like an IBAN start', () => {
  it.each([
    'The code BG80 was sent',
    'The code BG80 was sent to us by the hotel.',
    'Our flight LH12 landed late but the room was ready.',
  ])('is left as written: %s', (text) => {
    expect(financialCount(text, 'BG')).toBe(0)
    expect(redact(text, 'BG')).toMatchObject({ status: 'redacted', text })
  })
})
