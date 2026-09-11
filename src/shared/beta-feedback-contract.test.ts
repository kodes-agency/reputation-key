import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod/v4'
import {
  betaFeedbackInputSchema,
  classifyBetaFeedbackRoute,
  classifyBetaFeedbackViewport,
  formatBetaFeedbackMessage,
} from './beta-feedback-contract'

describe('beta feedback contract', () => {
  it.each(['bug', 'suggestion'] as const)('accepts text-only %s feedback', (kind) => {
    expect(
      betaFeedbackInputSchema.parse({
        kind,
        message: 'The workflow could be clearer.',
        routePath: '/dashboard',
        viewport: 'regular',
      }),
    ).toEqual({
      kind,
      message: 'The workflow could be clearer.',
      routePath: '/dashboard',
      viewport: 'regular',
    })
  })

  it.each(['attachment', 'screenshot', 'replayId'] as const)(
    'rejects the removed %s capture field',
    (field) => {
      expect(() =>
        betaFeedbackInputSchema.parse({
          kind: 'bug',
          message: 'The workflow did not complete.',
          routePath: '/dashboard',
          viewport: 'regular',
          [field]: 'private-capture',
        }),
      ).toThrow(ZodError)
    },
  )

  it.each([
    ['/properties/private-property-id', 'properties.property.overview'],
    ['/properties/private-property-id/ratings', 'properties.property.ratings'],
    ['/properties/private-property-id/google', 'properties.property.google'],
    ['/properties/private-property-id/guests', 'properties.property.guests'],
    ['/inbox', 'inbox'],
    ['/properties', 'properties.list'],
    ['/properties/import-google/opaque-import-id', 'properties.import.detail'],
    ['/properties/private-property-id/reviews', 'properties.property.reviews'],
    [
      '/properties/private-property-id/portals/private-portal-id',
      'properties.property.portals.detail',
    ],
    ['/settings/notifications', 'settings.notifications'],
    ['/not-a-known-route/private-value', 'other_authenticated'],
  ] as const)('classifies %s without retaining route identifiers', (path, expected) => {
    const route = classifyBetaFeedbackRoute(path)
    expect(route).toBe(expected)
    expect(route).not.toContain('private')
  })

  it('formats bounded, labelled messages without placing the raw route in them', () => {
    const marker = 'private-property-id'
    const message = formatBetaFeedbackMessage({
      kind: 'bug',
      message: 'The reviews page did not load. '.repeat(300),
      routePath: `/properties/${marker}/reviews`,
      viewport: 'wide',
    })

    expect(message).toContain('Type: Bug')
    expect(message).toContain('Route: properties.property.reviews')
    expect(message).not.toContain(marker)
    expect(message.length).toBeLessThanOrEqual(6_000)
  })

  it.each([
    [320, 'compact'],
    [639, 'compact'],
    [640, 'regular'],
    [1_279, 'regular'],
    [1_280, 'wide'],
  ] as const)('buckets a %dpx viewport as %s', (width, expected) => {
    expect(classifyBetaFeedbackViewport(width)).toBe(expected)
  })
})
