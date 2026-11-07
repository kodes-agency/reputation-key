import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import {
  emittedEventVersion,
  eventDescriptors,
  registerAllEventSchemas,
} from './registry.server'
import { clearEventSchemas, getEventSchema, registerEventSchema } from './schema-registry'

describe('event registry startup', () => {
  beforeEach(clearEventSchemas)

  it('registers every issued format and permits a second container to use it', () => {
    registerAllEventSchemas()
    expect(() => registerAllEventSchemas()).not.toThrow()
    for (const descriptor of eventDescriptors) {
      expect(getEventSchema(descriptor.type, descriptor.version)).toBe(descriptor)
    }
  })

  it('refuses a conflicting descriptor instead of skipping later registrations', () => {
    registerEventSchema({
      type: 'review.created',
      version: 1,
      schema: z.object({}),
      aggregate: { id: 'eventId', type: 'event' },
    })
    expect(() => registerAllEventSchemas()).toThrow(
      'Duplicate event schema: review.created:v1',
    )
  })
})

describe('issued event versions', () => {
  it.each([
    'guest.qualified_scan.recorded',
    'guest.qualified_scan.retracted',
    'guest.rating.submitted',
    'guest.rating.retracted',
    'guest.feedback.submitted',
    'guest.feedback.retracted',
    'metric.recorded',
    'metric.corrected',
  ] as const)('keeps attributed and pre-attribution %s formats distinct', (_tag) => {
    expect(emittedEventVersion({ _tag })).toBe(1)
    expect(emittedEventVersion({ _tag, staffAttribution: null })).toBe(2)
  })

  it.each(['guest.feedback.submitted', 'guest.feedback.retracted'] as const)(
    'keeps revisioned %s on v3, with or without staff attribution',
    (_tag) => {
      expect(emittedEventVersion({ _tag, responseRevision: 1 })).toBe(3)
      expect(
        emittedEventVersion({ _tag, responseRevision: 1, staffAttribution: null }),
      ).toBe(3)
    },
  )

  it('keeps scan-source facts and immersive completeness on their issued formats', () => {
    expect(emittedEventVersion({ _tag: 'guest.scan.recorded' })).toBe(1)
    expect(emittedEventVersion({ _tag: 'guest.scan.recorded', scanSource: 'qr' })).toBe(2)
    expect(
      emittedEventVersion({ _tag: 'portal.configuration_completeness.recorded' }),
    ).toBe(2)
    expect(
      emittedEventVersion({
        _tag: 'portal.configuration_completeness.recorded',
        fieldSet: 'immersive_hub',
      }),
    ).toBe(3)
  })

  it.each([
    'portal.responsibility_became_needed',
    'portal.responsible_managers.updated',
    'portal.content_review.completed',
    'portal.approved_destination_ratio.recorded',
    'portal_group.deleted',
    'review.reply.publication_requested',
    'identity.member.invited',
  ] as const)('issues %s on v2 while retaining its historical decoders', (_tag) => {
    expect(emittedEventVersion({ _tag })).toBe(2)
  })

  it('issues canonical Google connection facts on v3', () => {
    expect(emittedEventVersion({ _tag: 'integration.google_account.connected' })).toBe(3)
  })
})
