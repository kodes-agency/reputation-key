import { describe, expect, it } from 'vitest'
import { classifyQualifiedScanRequest } from './qualified-scan'

const BROWSER =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36'

describe('Qualified Scan request eligibility', () => {
  it('accepts an explicit artifact observation from an ordinary browser', () => {
    expect(
      classifyQualifiedScanRequest({
        accessArtifactId: '10000000-0000-4000-8000-000000000001',
        userAgent: BROWSER,
        purpose: null,
        secPurpose: null,
      }),
    ).toEqual({ eligible: true })
  })

  it.each([
    {
      name: 'direct URL',
      input: {
        accessArtifactId: null,
        userAgent: BROWSER,
        purpose: null,
        secPurpose: null,
      },
      reason: 'access_artifact_missing',
    },
    {
      name: 'prefetch',
      input: {
        accessArtifactId: '10000000-0000-4000-8000-000000000001',
        userAgent: BROWSER,
        purpose: 'prefetch',
        secPurpose: null,
      },
      reason: 'prefetch',
    },
    {
      name: 'prerender',
      input: {
        accessArtifactId: '10000000-0000-4000-8000-000000000001',
        userAgent: BROWSER,
        purpose: null,
        secPurpose: 'prefetch;prerender',
      },
      reason: 'prefetch',
    },
    {
      name: 'bot',
      input: {
        accessArtifactId: '10000000-0000-4000-8000-000000000001',
        userAgent: 'Googlebot/2.1',
        purpose: null,
        secPurpose: null,
      },
      reason: 'automated_agent',
    },
    {
      name: 'missing user agent',
      input: {
        accessArtifactId: '10000000-0000-4000-8000-000000000001',
        userAgent: null,
        purpose: null,
        secPurpose: null,
      },
      reason: 'automated_agent',
    },
    {
      name: 'scripted raw load',
      input: {
        accessArtifactId: '10000000-0000-4000-8000-000000000001',
        userAgent: 'curl/8.7.1',
        purpose: null,
        secPurpose: null,
      },
      reason: 'automated_agent',
    },
  ])('rejects $name observations', ({ input, reason }) => {
    expect(classifyQualifiedScanRequest(input)).toEqual({ eligible: false, reason })
  })
})
