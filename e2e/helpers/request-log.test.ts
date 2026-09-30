// The request log's font rules are the contract the guest font strategy leans
// on: the app's font CDNs are allowed by default (legacy pages still load
// them), and a page that must be self-hosted can assert it made none.

import type { Page, Request } from '@playwright/test'
import { describe, expect, it } from 'vitest'
import { attachRequestLog } from './request-log'

function logFor(urls: readonly string[]) {
  const listeners: Array<(request: Request) => void> = []
  const page = {
    on: (_event: string, listener: (request: Request) => void) => {
      listeners.push(listener)
    },
    off: () => undefined,
  } as unknown as Page
  const log = attachRequestLog(page)
  for (const url of urls) {
    for (const listener of listeners) {
      listener({ url: () => url, method: () => 'GET' } as unknown as Request)
    }
  }
  return log
}

describe('request log font rules', () => {
  it('allows the app font CDNs by default', () => {
    const log = logFor([
      'http://localhost:3001/p/token',
      'https://api.fontshare.com/v2/css?f[]=satoshi',
      'https://fonts.gstatic.com/s/plusjakarta.woff2',
    ])
    expect(() => log.assertNoExternalHosts(['localhost:3001'])).not.toThrow()
  })

  it('passes assertNoFontCdnRequests for a page that loads only its own fonts', () => {
    const log = logFor([
      'http://localhost:3001/p/token',
      'http://localhost:3001/fonts/guest/guest-fonts.css',
      'http://localhost:3001/fonts/guest/ysabeau-office-latin-400-normal.woff2',
    ])
    expect(() => log.assertNoFontCdnRequests()).not.toThrow()
  })

  it('fails assertNoFontCdnRequests when any font CDN was contacted', () => {
    for (const host of [
      'api.fontshare.com',
      'cdn.fontshare.com',
      'fonts.googleapis.com',
      'fonts.gstatic.com',
    ]) {
      const log = logFor(['http://localhost:3001/p/token', `https://${host}/x`])
      expect(() => log.assertNoFontCdnRequests(), host).toThrow(
        /expected zero font CDN requests/,
      )
    }
  })

  it('reports which font hosts a page contacted', () => {
    const log = logFor([
      'https://api.fontshare.com/v2/css',
      'https://api.fontshare.com/v2/css?again',
      'http://localhost:3001/p/token',
    ])
    expect(log.fontCdnHostsRequested()).toEqual(['api.fontshare.com'])
  })
})
