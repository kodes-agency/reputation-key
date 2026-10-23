import { describe, expect, it } from 'vitest'
import { classifyQualifiedScanRequest } from './qualified-scan'

const BROWSER =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36'

describe('Qualified Scan request eligibility', () => {
  it('accepts an explicit artifact observation from an ordinary browser', () => {
    expect(
      classifyQualifiedScanRequest({
        accessArtifactId: '10000000-0000-4000-8000-000000000001',
        markerImplied: false,
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
        markerImplied: false,
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
        markerImplied: false,
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
        markerImplied: false,
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
        markerImplied: false,
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
        markerImplied: false,
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
        markerImplied: false,
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

const ARTIFACT = '10000000-0000-4000-8000-000000000001'

function observedBy(userAgent: string | null) {
  return classifyQualifiedScanRequest({
    accessArtifactId: ARTIFACT,
    markerImplied: false,
    userAgent,
    purpose: null,
    secPurpose: null,
  })
}

describe('Qualified Scan user agents that are not a guest', () => {
  it.each([
    [
      'Googlebot smartphone',
      'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    ],
    [
      'bingbot',
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36',
    ],
    [
      'Applebot',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)',
    ],
    [
      'Yahoo Slurp',
      'Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)',
    ],
    ['DuckDuckBot', 'DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)'],
    ['YandexBot', 'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)'],
    [
      'Baiduspider',
      'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)',
    ],
    [
      'UptimeRobot',
      'Mozilla/5.0+(compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)',
    ],
  ])('rejects the %s crawler', (_name, userAgent) => {
    expect(observedBy(userAgent)).toEqual({ eligible: false, reason: 'automated_agent' })
  })

  it.each([
    [
      'Facebook',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    ],
    [
      'Facebook Facebot',
      'Mozilla/5.0 (compatible; Facebot 1.0; https://developers.facebook.com/docs/sharing/webmasters/crawler)',
    ],
    ['WhatsApp', 'WhatsApp/2.23.20.0 A'],
    ['Telegram', 'TelegramBot (like TwitterBot)'],
    ['Slack', 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'],
    ['Twitter', 'Twitterbot/1.0'],
    [
      'LinkedIn',
      'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
    ],
    ['Discord', 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'],
    [
      'Skype',
      'Mozilla/5.0 (Windows NT 6.1; WOW64) SkypeUriPreview Preview/0.5 skype-url-preview@microsoft.com',
    ],
  ])(
    'rejects the %s link preview, which opens the link for the chat, not a guest',
    (_name, userAgent) => {
      expect(observedBy(userAgent)).toEqual({
        eligible: false,
        reason: 'automated_agent',
      })
    },
  )

  it.each([
    [
      'headless Chrome',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36',
    ],
    [
      'Lighthouse',
      'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse',
    ],
    ['python-requests', 'python-requests/2.31.0'],
    ['node-fetch', 'node-fetch/1.0 (+https://github.com/bitinn/node-fetch)'],
    ['axios', 'axios/1.6.7'],
    ['Go', 'Go-http-client/2.0'],
    ['Apache HttpClient', 'Apache-HttpClient/4.5.13 (Java/17.0.9)'],
    ['wget', 'Wget/1.21.4'],
  ])('rejects %s, a script or test runner rather than a guest', (_name, userAgent) => {
    expect(observedBy(userAgent)).toEqual({ eligible: false, reason: 'automated_agent' })
  })

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
  ])('rejects a user agent that is %s', (_name, userAgent) => {
    expect(observedBy(userAgent)).toEqual({ eligible: false, reason: 'automated_agent' })
  })
})

// The pattern's bare "bot" also matches a handset whose model name contains it
// (the CUBOT phones); that is a known over-match, so no such device is listed.
describe('Qualified Scan user agents that are a guest', () => {
  it.each([
    [
      'iPhone Safari',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    ],
    [
      'iPad Safari',
      'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    ],
    [
      'Pixel Chrome',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
    ],
    [
      'Samsung Internet',
      'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
    ],
    [
      'Firefox on Android',
      'Mozilla/5.0 (Android 14; Mobile; rv:128.0) Gecko/128.0 Firefox/128.0',
    ],
    [
      'Firefox on Windows',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
    ],
    [
      'Edge on Windows',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
    ],
    [
      'Xiaomi browser',
      'Mozilla/5.0 (Linux; U; Android 13; en-us; 2201116SG Build/TKQ1.221114.001) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 XiaoMi/MiuiBrowser/17.4.30',
    ],
    [
      'Instagram in-app browser',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 340.0.0.12.108 (iPhone14,5; iOS 17_5; en_US; en-US; scale=3.00; 1170x2532; 600645573)',
    ],
    [
      'Facebook in-app browser',
      'Mozilla/5.0 (Linux; Android 13; SM-A546B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/460.0.0.45.108;]',
    ],
  ])('accepts %s', (_name, userAgent) => {
    expect(observedBy(userAgent)).toEqual({ eligible: true })
  })
})

describe('Qualified Scan speculative loads', () => {
  it.each([
    ['Purpose: prefetch', { purpose: 'prefetch', secPurpose: null }],
    ['Purpose: Prefetch, in capitals', { purpose: 'Prefetch', secPurpose: null }],
    ['Purpose: prerender', { purpose: 'prerender', secPurpose: null }],
    ['Sec-Purpose: prefetch', { purpose: null, secPurpose: 'prefetch' }],
    [
      'Sec-Purpose: prefetch;prerender',
      { purpose: null, secPurpose: 'prefetch;prerender' },
    ],
    [
      'Sec-Purpose: prefetch;anonymous-client-ip',
      { purpose: null, secPurpose: 'prefetch;anonymous-client-ip' },
    ],
  ])('rejects a browser that sends %s', (_name, headers) => {
    expect(
      classifyQualifiedScanRequest({
        accessArtifactId: ARTIFACT,
        markerImplied: false,
        userAgent: BROWSER,
        ...headers,
      }),
    ).toEqual({ eligible: false, reason: 'prefetch' })
  })

  it('names the missing artifact before the user agent or the purpose', () => {
    expect(
      classifyQualifiedScanRequest({
        accessArtifactId: null,
        markerImplied: false,
        userAgent: 'Googlebot/2.1',
        purpose: 'prefetch',
        secPurpose: null,
      }),
    ).toEqual({ eligible: false, reason: 'access_artifact_missing' })
  })

  it('names a prefetch before the user agent, as a prefetching bot is still a prefetch', () => {
    expect(
      classifyQualifiedScanRequest({
        accessArtifactId: ARTIFACT,
        markerImplied: false,
        userAgent: 'Googlebot/2.1',
        purpose: 'prefetch',
        secPurpose: null,
      }),
    ).toEqual({ eligible: false, reason: 'prefetch' })
  })
})

// A print code names its own artifact (ADR 0069), so the request carries no marker
// and the address says so. Everything else about a qualified scan stays as it is.
describe('Qualified Scan of a print code', () => {
  const printCodeVisit = (
    patch: Partial<Parameters<typeof classifyQualifiedScanRequest>[0]> = {},
  ) =>
    classifyQualifiedScanRequest({
      accessArtifactId: null,
      markerImplied: true,
      userAgent: BROWSER,
      purpose: null,
      secPurpose: null,
      ...patch,
    })

  it('is eligible with no marker from an ordinary browser', () => {
    expect(printCodeVisit()).toEqual({ eligible: true })
  })

  it('is eligible when it also claims a marker', () => {
    expect(printCodeVisit({ accessArtifactId: ARTIFACT })).toEqual({ eligible: true })
  })

  it('still refuses a visit that has neither a marker nor a print code', () => {
    expect(printCodeVisit({ markerImplied: false })).toEqual({
      eligible: false,
      reason: 'access_artifact_missing',
    })
  })

  it.each([
    ['a prefetch', { purpose: 'prefetch' }, 'prefetch'],
    ['a prerender', { secPurpose: 'prefetch;prerender' }, 'prefetch'],
    ['a bot', { userAgent: 'Googlebot/2.1' }, 'automated_agent'],
    ['a missing user agent', { userAgent: null }, 'automated_agent'],
    ['a link preview', { userAgent: 'WhatsApp/2.23.20.0 A' }, 'automated_agent'],
  ] as const)('refuses %s as it refuses one with a marker', (_name, patch, reason) => {
    expect(printCodeVisit(patch)).toEqual({ eligible: false, reason })
  })
})
