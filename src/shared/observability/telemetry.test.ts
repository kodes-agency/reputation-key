import { describe, it, expect } from 'vitest'
import { scrubSentryEvent } from './telemetry'

describe('telemetry PII scrubbing (B3.5)', () => {
  it('redacts known PII fields', () => {
    const event = {
      message: 'Something happened',
      email: 'user@example.com',
      token: 'abc123',
      reviewText: 'Terrible service',
    }
    const scrubbed = scrubSentryEvent(event) as Record<string, unknown>

    expect(scrubbed.email).toBe('[REDACTED]')
    expect(scrubbed.token).toBe('[REDACTED]')
    expect(scrubbed.reviewText).toBe('[REDACTED]')
    expect(scrubbed.message).toBe('Something happened')
  })

  it('redacts nested PII fields', () => {
    const event = {
      extra: {
        reviewerName: 'John Doe',
        context: {
          accessToken: 'secret-token',
        },
      },
    }
    const scrubbed = scrubSentryEvent(event) as Record<string, unknown>
    const extra = scrubbed.extra as Record<string, unknown>
    const context = extra.context as Record<string, unknown>

    expect(extra.reviewerName).toBe('[REDACTED]')
    expect(context.accessToken).toBe('[REDACTED]')
  })

  it('redacts PII in URL strings', () => {
    const event = {
      url: '/api/reviews/550e8400-e29b-41d4-a716-446655440000/reply',
      query: 'token=secret123&key=apiKey456',
    }
    const scrubbed = scrubSentryEvent(event) as Record<string, unknown>

    expect(scrubbed.url).not.toContain('550e8400')
    expect(scrubbed.query).not.toContain('secret123')
    expect(scrubbed.query).not.toContain('apiKey456')
  })

  it('redacts PII in arrays', () => {
    const event = {
      breadcrumbs: [
        { data: { email: 'a@b.com', action: 'click' } },
        { data: { token: 'xyz', action: 'navigate' } },
      ],
    }
    const scrubbed = scrubSentryEvent(event) as Record<string, unknown>
    const breadcrumbs = scrubbed.breadcrumbs as Array<Record<string, unknown>>

    expect((breadcrumbs[0].data as Record<string, unknown>).email).toBe('[REDACTED]')
    expect((breadcrumbs[0].data as Record<string, unknown>).action).toBe('click')
    expect((breadcrumbs[1].data as Record<string, unknown>).token).toBe('[REDACTED]')
  })

  it('preserves non-PII data', () => {
    const event = {
      level: 'error',
      timestamp: 1784123456000,
      platform: 'node',
      tags: { queue: 'default', context: 'review' },
    }
    const scrubbed = scrubSentryEvent(event) as Record<string, unknown>

    expect(scrubbed.level).toBe('error')
    expect(scrubbed.platform).toBe('node')
    const tags = scrubbed.tags as Record<string, unknown>
    expect(tags.queue).toBe('default')
  })

  it('handles circular references without crashing', () => {
    const circular: Record<string, unknown> = { name: 'test' }
    circular.self = circular
    const scrubbed = scrubSentryEvent({ data: circular })
    expect(scrubbed).toBeDefined()
  })

  it('handles null and undefined', () => {
    expect(scrubSentryEvent(null)).toBeNull()
    expect(scrubSentryEvent(undefined)).toBeUndefined()
  })
})
