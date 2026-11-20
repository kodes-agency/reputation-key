import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GooglePerformanceError } from './google-performance-states'

const renderError = (code: string): string =>
  renderToStaticMarkup(createElement(GooglePerformanceError, { code }))

describe('GooglePerformanceError', () => {
  it('directs a stale own-side authorization to the visible Refresh control', () => {
    expect(renderError('authorization_stale')).toContain(
      'This live report needs a fresh authorization. Select Refresh to request it.',
    )
  })

  it('keeps an unrecognised error provider-neutral and directs the operator to Refresh', () => {
    expect(renderError('unrecognised_error')).toContain(
      'This performance report could not be loaded. Select Refresh to try again.',
    )
  })

  it.each([
    [
      'rate_limited',
      'Google is limiting requests. Keep the current report or retry after the wait period.',
    ],
    [
      'provider_timeout',
      'Google took too long to respond. The rest of your Dashboard is still current.',
    ],
    [
      'provider_rejected',
      'Google could not authorize this report. Check the property connection.',
    ],
    [
      'malformed_provider_response',
      'Google returned data that could not be safely displayed.',
    ],
    [
      'temporarily_unavailable',
      'Google Business Profile performance is temporarily unavailable.',
    ],
  ])('keeps the existing Google-specific copy for %s', (code, message) => {
    expect(renderError(code)).toContain(message)
  })
})
