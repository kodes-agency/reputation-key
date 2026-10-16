import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedbackCaptureParams } from '#/shared/observability/telemetry'
import type { BetaFeedbackInput } from '#/shared/beta-feedback-contract'

const captured = vi.hoisted(() => ({ params: [] as FeedbackCaptureParams[] }))

vi.mock('#/shared/observability/telemetry', () => ({
  captureObservabilityFeedback: (params: FeedbackCaptureParams) => {
    captured.params.push(params)
    return 'c'.repeat(32)
  },
}))

import { deliverBetaFeedback } from './beta-feedback-sentry-delivery.adapter'

const WEBP_BYTES = Uint8Array.from([
  ...[...'RIFF'].map((c) => c.charCodeAt(0)),
  0x24,
  0,
  0,
  0,
  ...[...'WEBPVP8 '].map((c) => c.charCodeAt(0)),
])

function report(screenshot: BetaFeedbackInput['screenshot']): BetaFeedbackInput {
  return {
    kind: 'bug',
    impact: 'small_issue',
    message: 'The total row is missing.',
    routePath: '/inbox',
    viewport: 'wide',
    clientErrorEventId: null,
    maskedLayout: null,
    screenshot,
  }
}

const actor = {
  userId: 'user-1',
  organizationId: 'org-1',
  role: 'AccountAdmin',
} as const

describe('beta feedback delivery to monitoring', () => {
  beforeEach(() => {
    captured.params.length = 0
  })

  it('sends an attached screenshot as an image file of the report', () => {
    const base64 = Buffer.from(WEBP_BYTES).toString('base64')

    const result = deliverBetaFeedback({
      data: report({ mediaType: 'image/webp', base64 }),
      actor,
      hmacSecret: 'secret',
      reference: '00000000-0000-4000-8000-000000000001',
    })

    expect(result).toEqual({ status: 'delivered', providerReference: 'c'.repeat(32) })
    const [sent] = captured.params
    expect(sent?.attachments).toEqual([
      { filename: 'screenshot.webp', data: WEBP_BYTES, contentType: 'image/webp' },
    ])
    expect(sent?.message).toContain('Screenshot: attached (image/webp, 1 KB)')
    expect(sent?.message).not.toContain(base64)
  })

  it('sends no file when the reporter attached none', () => {
    deliverBetaFeedback({
      data: report(null),
      actor,
      hmacSecret: 'secret',
      reference: '00000000-0000-4000-8000-000000000002',
    })

    const [sent] = captured.params
    expect(sent?.attachments).toEqual([])
    expect(sent?.message).not.toContain('Screenshot:')
  })
})
