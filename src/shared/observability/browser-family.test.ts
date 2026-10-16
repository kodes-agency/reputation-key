import { describe, expect, it } from 'vitest'
import { browserFamily } from './browser-family'

describe('browserFamily', () => {
  it.each([
    [
      'Chrome on macOS',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      { browser: { name: 'Chrome', version: '141' }, os: { name: 'macOS' } },
    ],
    [
      'Safari on macOS',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
      { browser: { name: 'Safari', version: '18' }, os: { name: 'macOS' } },
    ],
    [
      'Safari on an iPhone',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
      { browser: { name: 'Safari', version: '18' }, os: { name: 'iOS' } },
    ],
    [
      'Chrome on an iPhone',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1',
      { browser: { name: 'Chrome', version: '141' }, os: { name: 'iOS' } },
    ],
    [
      'Firefox on Windows',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0',
      { browser: { name: 'Firefox', version: '143' }, os: { name: 'Windows' } },
    ],
    [
      'Edge on Windows',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
      { browser: { name: 'Edge', version: '141' }, os: { name: 'Windows' } },
    ],
    [
      'Opera on Linux',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 OPR/125.0.0.0',
      { browser: { name: 'Opera', version: '125' }, os: { name: 'Linux' } },
    ],
    [
      'Chrome on Android',
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
      { browser: { name: 'Chrome', version: '141' }, os: { name: 'Android' } },
    ],
    [
      'Samsung Internet',
      'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
      { browser: { name: 'Samsung Internet', version: '28' }, os: { name: 'Android' } },
    ],
    [
      'Chrome on Chrome OS',
      'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      { browser: { name: 'Chrome', version: '141' }, os: { name: 'Chrome OS' } },
    ],
  ])('reads %s', (_label, userAgent, family) => {
    expect(browserFamily(userAgent)).toEqual(family)
  })

  it('says nothing about text it does not recognise', () => {
    expect(browserFamily('Node.js/22')).toEqual({})
    expect(browserFamily('')).toEqual({})
  })
})
