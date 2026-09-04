import { describe, expect, it } from 'vitest'
import {
  filterAndScrubSentryTransaction,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
} from './sentry-event-scrub'

describe('telemetry PII scrubbing (B3.5)', () => {
  it.each([
    '/health/live',
    '/health/ready',
    '/api/health/started',
    '/api/health/live',
    '/api/health/ready',
    '/api/health/metrics',
  ])('drops the operational probe transaction %s before Sentry delivery', (path) => {
    expect(
      filterAndScrubSentryTransaction({
        transaction: `GET ${path}`,
        request: { method: 'GET', url: `https://service.invalid${path}` },
      }),
    ).toBeNull()
  })

  it('retains and scrubs a non-health transaction', () => {
    expect(
      filterAndScrubSentryTransaction({
        transaction: 'GET /api/properties/tenant-secret',
        request: {
          method: 'GET',
          url: 'https://service.invalid/api/properties/tenant-secret?token=secret',
        },
      }),
    ).toEqual({
      transaction: '[REDACTED]',
      request: { method: 'GET' },
    })
  })

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
    expect(scrubbed.message).toBe('[REDACTED]')
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
    expect(scrubbed).not.toHaveProperty('extra')
  })

  it('uses the same normalized credential and personal-data vocabulary as logs', () => {
    const marker = 'marker-private-value'
    const scrubbed = scrubSentryEvent({
      password_hash: marker,
      clientSecret: marker,
      OPENAI_API_KEY: marker,
      contactEmail: marker,
      DATABASE_URL: `postgresql://user:${marker}@database/repkey`,
      outcomeCode: 'provider_rejected',
    }) as Record<string, unknown>

    expect(JSON.stringify(scrubbed)).not.toContain(marker)
    expect(scrubbed.outcomeCode).toBe('provider_rejected')
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

    expect(breadcrumbs[0]).toEqual({})
    expect(breadcrumbs[1]).toEqual({})
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
    const circular: Record<string, unknown> = {
      name: 'test',
      clientSecret: 'marker-private-value',
    }
    circular.self = circular
    const scrubbed = scrubSentryEvent(circular) as Record<string, unknown>

    expect(scrubbed.clientSecret).toBe('[REDACTED]')
    expect(scrubbed.self).toBe(scrubbed)
  })

  it('handles null and undefined', () => {
    expect(scrubSentryEvent(null)).toBeNull()
    expect(scrubSentryEvent(undefined)).toBeUndefined()
  })

  it('removes arbitrary exception messages, request content, user data, and extras', () => {
    const marker = 'seeded-private-review-and-contact'
    const scrubbed = scrubSentryEvent({
      message: marker,
      transaction: `/properties/${marker}/reviews`,
      exception: {
        values: [{ type: 'Error', value: marker, stacktrace: { frames: [] } }],
      },
      request: {
        method: 'POST',
        url: `https://eu.example.invalid/portal/${marker}?token=${marker}`,
        headers: { cookie: marker },
        cookies: { session: marker },
        data: { feedback: marker },
        query_string: `contact=${marker}`,
      },
      user: { id: marker, email: `${marker}@example.invalid` },
      extra: { arbitrary: marker },
      tags: { service: 'web', tenant_name: marker },
      contexts: {
        runtime: { name: 'node', version: '22.23.2', commandLine: marker },
        custom: { note: marker },
      },
      fingerprint: [marker],
      logentry: { formatted: marker },
      breadcrumbs: [{ category: 'http', message: marker, data: { body: marker } }],
    }) as Record<string, unknown>

    expect(JSON.stringify(scrubbed)).not.toContain(marker)
    expect(scrubbed.message).toBe('[REDACTED]')
    expect(scrubbed.transaction).toBe('[REDACTED]')
    expect(scrubbed.request).toEqual({ method: 'POST' })
    expect(scrubbed).not.toHaveProperty('user')
    expect(scrubbed).not.toHaveProperty('extra')
    expect(scrubbed).not.toHaveProperty('fingerprint')
    expect(scrubbed).not.toHaveProperty('logentry')
    expect(scrubbed.tags).toEqual({ service: 'web' })
    expect(scrubbed.contexts).toEqual({
      runtime: { name: 'node', version: '22.23.2' },
    })
  })

  it('keeps only non-content breadcrumb metadata', () => {
    expect(
      scrubSentryBreadcrumb({
        type: 'http',
        category: 'fetch',
        level: 'error',
        timestamp: 123,
        message: 'private review text',
        data: { url: '/portal/private-hotel', responseBody: 'private feedback' },
      }),
    ).toEqual({ type: 'http', category: 'fetch', level: 'error', timestamp: 123 })
  })

  it('preserves only the intentional feedback message and controlled tags', () => {
    const marker = 'private-review-marker'
    const scrubbed = scrubSentryEvent({
      type: 'feedback',
      contexts: {
        feedback: {
          message: `Expected the page to load. Contact a@b.example. token=${marker}`,
          source: 'repkey-native-beta-feedback',
          contact_email: 'manager@example.com',
          name: 'Manager Name',
          replay_id: marker,
          url: `/properties/${marker}`,
        },
        custom: { reviewText: marker },
      },
      tags: {
        service: 'web',
        feedback_type: 'bug',
        feedback_impact: 'blocking',
        feedback_route: 'properties.property.reviews',
        feedback_actor: 'b'.repeat(64),
        feedback_organization: 'c'.repeat(64),
        tenant_name: marker,
      },
      user: { email: 'manager@example.com' },
      extra: { reviewText: marker },
    }) as Record<string, unknown>

    expect(scrubbed).not.toHaveProperty('user')
    expect(scrubbed).not.toHaveProperty('extra')
    expect(scrubbed.contexts).toEqual({
      feedback: {
        message: 'Expected the page to load. Contact [REDACTED]. token=[REDACTED]',
        source: 'repkey-native-beta-feedback',
      },
    })
    expect(scrubbed.tags).toEqual({
      service: 'web',
      feedback_type: 'bug',
      feedback_impact: 'blocking',
      feedback_route: 'properties.property.reviews',
      feedback_actor: 'b'.repeat(64),
      feedback_organization: 'c'.repeat(64),
    })
    expect(JSON.stringify(scrubbed)).not.toContain(marker)
    expect(JSON.stringify(scrubbed)).not.toContain('manager@example.com')
  })
})
