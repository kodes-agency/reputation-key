import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedbackCaptureParams } from '#/shared/observability/telemetry'
import { scrubSentryTags } from '#/shared/observability/sentry-event-scrub'
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

const WEBP_SCREENSHOT: NonNullable<BetaFeedbackInput['screenshot']> = {
  mediaType: 'image/webp',
  base64: Buffer.from(WEBP_BYTES).toString('base64'),
}

const MASKED_LAYOUT: NonNullable<BetaFeedbackInput['maskedLayout']> = {
  width: 1280,
  height: 800,
  boxes: [{ x: 0, y: 0, w: 320, h: 48, role: 'heading' }],
}

function report(
  screenshot: BetaFeedbackInput['screenshot'],
  maskedLayout: BetaFeedbackInput['maskedLayout'] = null,
): BetaFeedbackInput {
  return {
    kind: 'bug',
    impact: 'small_issue',
    message: 'The total row is missing.',
    routePath: '/inbox',
    viewport: 'wide',
    clientErrorEventId: null,
    maskedLayout,
    screenshot,
  }
}

const actor = {
  userId: 'user-1',
  organizationId: 'org-1',
  role: 'AccountAdmin',
} as const

const reporter = { name: 'Ana Admin', email: 'ana@example.com' } as const

describe('beta feedback delivery to monitoring', () => {
  beforeEach(() => {
    captured.params.length = 0
  })

  it('sends an attached screenshot as an image file of the report', () => {
    const { base64 } = WEBP_SCREENSHOT

    const result = deliverBetaFeedback({
      data: report(WEBP_SCREENSHOT),
      actor,
      reporter,
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
      reporter,
      hmacSecret: 'secret',
      reference: '00000000-0000-4000-8000-000000000002',
    })

    const [sent] = captured.params
    expect(sent?.attachments).toEqual([])
    expect(sent?.message).not.toContain('Screenshot:')
  })

  it("names the report by the reporter's account, outside the report text", () => {
    deliverBetaFeedback({
      data: report(null),
      actor,
      reporter,
      hmacSecret: 'secret',
      reference: '00000000-0000-4000-8000-000000000003',
    })

    const [sent] = captured.params
    expect(sent?.reporter).toEqual(reporter)
    expect(sent?.message).not.toContain(reporter.email)
  })

  it('sends no reporter when the account is gone', () => {
    deliverBetaFeedback({
      data: report(null),
      actor,
      reporter: null,
      hmacSecret: 'secret',
      reference: '00000000-0000-4000-8000-000000000004',
    })

    expect(captured.params[0]).not.toHaveProperty('reporter')
  })
})

describe('beta feedback attachment tags', () => {
  beforeEach(() => {
    captured.params.length = 0
  })

  function sentTags(data: BetaFeedbackInput): Readonly<Record<string, string>> {
    deliverBetaFeedback({
      data,
      actor,
      reporter: null,
      hmacSecret: 'secret',
      reference: '00000000-0000-4000-8000-000000000010',
    })
    const tags = captured.params[0]?.tags
    if (!tags) throw new Error('nothing was sent to monitoring')
    return tags
  }

  // Each case pins all three tags: `feedback_attachment` and its retention
  // keep meaning the masked layout alone, so saved searches still match.
  it.each([
    {
      carries: 'a screenshot only',
      data: report(WEBP_SCREENSHOT),
      tags: {
        feedback_screenshot: 'attached',
        feedback_attachment: 'none',
        feedback_attachment_retention: 'not_applicable',
      },
    },
    {
      carries: 'a masked layout only',
      data: report(null, MASKED_LAYOUT),
      tags: {
        feedback_screenshot: 'none',
        feedback_attachment: 'masked_layout_v1',
        feedback_attachment_retention: 'expires_30d',
      },
    },
    {
      carries: 'a screenshot and a masked layout',
      data: report(WEBP_SCREENSHOT, MASKED_LAYOUT),
      tags: {
        feedback_screenshot: 'attached',
        feedback_attachment: 'masked_layout_v1',
        feedback_attachment_retention: 'expires_30d',
      },
    },
    {
      carries: 'neither',
      data: report(null),
      tags: {
        feedback_screenshot: 'none',
        feedback_attachment: 'none',
        feedback_attachment_retention: 'not_applicable',
      },
    },
  ])('tags a report that carries $carries', ({ data, tags }) => {
    expect(sentTags(data)).toMatchObject(tags)
  })

  it('keeps the screenshot tag through the monitoring scrubber', () => {
    // The scrubber drops any tag key it does not allow, so a key missing
    // from its list would never reach monitoring.
    const tags = sentTags(report(WEBP_SCREENSHOT, MASKED_LAYOUT))

    expect(scrubSentryTags(tags)).toMatchObject({
      feedback_screenshot: 'attached',
      feedback_attachment: 'masked_layout_v1',
      feedback_attachment_retention: 'expires_30d',
    })
  })
})
