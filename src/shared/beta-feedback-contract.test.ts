import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod/v4'
import {
  BETA_FEEDBACK_ATTACHMENT_RETENTION_DAYS,
  betaFeedbackInputSchema,
  classifyBetaFeedbackRoute,
  classifyBetaFeedbackViewport,
  isBetaFeedbackAttachmentAllowed,
  formatBetaFeedbackMessage,
  maskedLayoutSnapshotSchema,
} from './beta-feedback-contract'

describe('beta feedback contract', () => {
  it('accepts the two intentionally distinct report shapes', () => {
    expect(
      betaFeedbackInputSchema.parse({
        type: 'bug',
        title: 'Reviews page did not load',
        expected: 'The reviews list should appear.',
        actual: 'The loading state remained on screen.',
        steps: 'Open a property and select Reviews.',
        impact: 'workaround_available',
        routePath: '/properties/property-1/reviews',
        viewport: 'wide',
      }),
    ).toMatchObject({ type: 'bug', impact: 'workaround_available' })

    expect(
      betaFeedbackInputSchema.parse({
        type: 'suggestion',
        title: 'Keep the selected property visible',
        desiredOutcome: 'Show the selected property while moving between pages.',
        currentFriction: 'I need to check the property name again.',
        importance: 'helpful',
        routePath: '/inbox',
        viewport: 'compact',
      }),
    ).toMatchObject({ type: 'suggestion', importance: 'helpful' })
  })

  it('accepts only a bounded, content-free masked layout on Bug reports', () => {
    const attachment = {
      profile: 'masked-layout-v1',
      consented: true,
      gridWidth: 64,
      gridHeight: 40,
      blocks: [
        { kind: 'surface', x: 0, y: 0, width: 64, height: 40 },
        { kind: 'input', x: 8, y: 12, width: 32, height: 4 },
      ],
    } as const

    expect(maskedLayoutSnapshotSchema.parse(attachment)).toEqual(attachment)
    expect(
      betaFeedbackInputSchema.parse({
        type: 'bug',
        title: 'A reproducible problem',
        expected: 'The action should finish.',
        actual: 'The action remains pending.',
        impact: 'small_issue',
        routePath: '/dashboard',
        viewport: 'regular',
        attachment,
      }),
    ).toMatchObject({ type: 'bug', attachment })

    expect(() =>
      betaFeedbackInputSchema.parse({
        type: 'suggestion',
        title: 'A useful improvement',
        desiredOutcome: 'Make this workflow clearer for managers.',
        importance: 'helpful',
        routePath: '/dashboard',
        viewport: 'regular',
        attachment,
      }),
    ).toThrow(ZodError)
    expect(() =>
      betaFeedbackInputSchema.parse({
        type: 'bug',
        title: 'A reproducible problem',
        expected: 'The action should finish.',
        actual: 'The action remains pending.',
        impact: 'small_issue',
        routePath: '/dashboard',
        viewport: 'regular',
        replayId: 'private-replay',
      }),
    ).toThrow(ZodError)
    expect(() =>
      maskedLayoutSnapshotSchema.parse({
        ...attachment,
        blocks: [{ kind: 'text', x: 0, y: 0, width: 65, height: 1 }],
      }),
    ).toThrow(ZodError)
    expect(JSON.stringify(attachment)).not.toContain('private')
    expect(BETA_FEEDBACK_ATTACHMENT_RETENTION_DAYS).toBe(30)
  })

  it.each([
    ['/dashboard', true],
    ['/inbox', false],
    ['/properties/import-google', false],
    ['/properties/private-property-id/reviews', false],
    ['/settings/integrations', false],
    ['/settings/profile', false],
    ['/settings/security', false],
    ['/not-a-known-route/private-value', false],
  ] as const)(
    'applies the sensitive-route attachment denylist to %s',
    (path, allowed) => {
      expect(isBetaFeedbackAttachmentAllowed(path)).toBe(allowed)
    },
  )

  it.each([
    ['/dashboard', 'dashboard'],
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
      type: 'bug',
      title: 'Reviews page did not load',
      expected: 'The reviews list should appear.',
      actual: 'The loading state remained on screen.',
      steps: 'Open Reviews. '.repeat(600),
      impact: 'cannot_complete',
      routePath: `/properties/${marker}/reviews`,
      viewport: 'wide',
    })

    expect(message).toContain('Type: Bug')
    expect(message).toContain('Expected: The reviews list should appear.')
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
