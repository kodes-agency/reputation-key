import { describe, expect, it } from 'vitest'
import {
  classifyOpenAiStatus,
  enforceOutboundFetchDisposition,
  parseOpenAiJsonContentType,
  parseOpenAiRetryAfter,
} from './dispositions'

describe('OpenAI response disposition profiles', () => {
  it('classifies every HTTP status without gaps or overlap', () => {
    for (let status = 100; status <= 599; status += 1) {
      const value = classifyOpenAiStatus(status)
      expect(value.status).toBe(status)
      if (status === 200)
        expect(value).toMatchObject({ disposition: 'success', retryable: false })
      else if (status === 429)
        expect(value).toMatchObject({
          disposition: 'rate_limited',
          retryable: true,
          circuitFailure: true,
        })
      else if ([500, 502, 503, 504].includes(status))
        expect(value).toMatchObject({
          disposition: 'provider_unavailable',
          retryable: true,
          circuitFailure: true,
        })
      else if (
        status >= 400 &&
        status <= 499 &&
        ![401, 403, 404, 408, 409].includes(status)
      )
        expect(value).toMatchObject({
          disposition: 'provider_refused',
          retryable: false,
          circuitFailure: false,
        })
      else
        expect(value).toMatchObject({
          disposition: 'provider_unavailable',
          retryable: false,
          circuitFailure: true,
        })
    }
  })

  it.each([
    ['application/json', true],
    ['APPLICATION/JSON', true],
    ['application/json;charset=utf-8', true],
    ['application/json ; charset = UTF-8', true],
    ['application/json; charset="utf-8"', false],
    ['application/json; charset=utf-8, application/json', false],
    ['application/json; charset=utf-8; foo=bar', false],
    ['text/json', false],
  ])('validates the strict JSON media profile: %s', (value, accepted) => {
    expect(parseOpenAiJsonContentType(value)).toBe(accepted)
  })

  it.each([
    [null, null],
    ['0', null],
    ['1', 1],
    ['300', 300],
    ['301', null],
    ['01', null],
    [' 10 ', null],
    ['1, 2', null],
    ['Wed, 21 Oct 2015 07:28:00 GMT', null],
    ['1 0', null],
    ['\t10\t', null],
    ['\u00a010\u00a0', null],
    ['\r10\r', null],
    ['\n10\n', null],
    ['\v10\v', null],
    ['\f10\f', null],
    ['+10', null],
    ['-10', null],
    ['1.5', null],
    ['999999999999999999999999', null],
  ])('normalizes Retry-After: %s', (value, expected) => {
    expect(parseOpenAiRetryAfter(value)).toBe(expected)
  })

  it('relies on Fetch Headers to trim permitted HTTP OWS before parsing', () => {
    expect(
      parseOpenAiRetryAfter(
        new Headers({ 'retry-after': ' \t10\t ' }).get('retry-after'),
      ),
    ).toBe(10)
    expect(
      parseOpenAiRetryAfter(new Headers({ 'retry-after': '1, 2' }).get('retry-after')),
    ).toBeNull()
    expect(
      parseOpenAiRetryAfter(
        new Headers({ 'retry-after': '1\u00a00' }).get('retry-after'),
      ),
    ).toBeNull()
  })
})

describe('connector outbound-dispatch invariant', () => {
  const success = {
    disposition: 'success',
    reportedDisposition: 'success',
    result: { accepted: true },
    usageKnown: true,
    providerRetryable: false,
    usage: {
      inputTokens: 12,
      cachedTokens: 2,
      outputTokens: 3,
      reasoningTokens: 1,
      totalTokens: 15,
    },
    retryAfterSeconds: null,
    outboundFetchUsed: true,
  } as const

  it('preserves an internally consistent provider outcome', () => {
    expect(enforceOutboundFetchDisposition(success)).toBe(success)
  })

  it('charges ambiguity when a buggy connector claims no dispatch after the boundary', () => {
    expect(
      enforceOutboundFetchDisposition({
        ...success,
        disposition: 'no_dispatch',
        reportedDisposition: 'no_dispatch',
        result: null,
      }),
    ).toEqual({
      disposition: 'transport_ambiguous',
      reportedDisposition: 'transport_ambiguous',
      result: null,
      usageKnown: false,
      providerRetryable: false,
      usage: {
        inputTokens: 0,
        cachedTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
      },
      retryAfterSeconds: null,
      outboundFetchUsed: true,
    })
  })

  it('releases as no-dispatch when the connector reports a provider outcome before the boundary', () => {
    expect(
      enforceOutboundFetchDisposition({
        ...success,
        outboundFetchUsed: false,
      }),
    ).toMatchObject({
      disposition: 'no_dispatch',
      reportedDisposition: 'no_dispatch',
      result: null,
      usageKnown: false,
      providerRetryable: false,
      outboundFetchUsed: false,
    })
  })
})
