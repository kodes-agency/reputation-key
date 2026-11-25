import { describe, expect, it } from 'vitest'
import {
  emittedEventVersion,
  eventDescriptors,
  getEventDescriptor,
} from './registry.server'

describe('event registry', () => {
  it('serves every issued format', () => {
    for (const descriptor of eventDescriptors) {
      expect(getEventDescriptor(descriptor.type, descriptor.version)).toBe(descriptor)
    }
  })

  it('defines each event type and version once', () => {
    const keys = eventDescriptors.map(({ type, version }) => `${type}:v${version}`)
    expect(keys.filter((key, index) => keys.indexOf(key) !== index)).toEqual([])
  })

  it('serves no format that is not defined', () => {
    expect(getEventDescriptor('review.created', 999)).toBeUndefined()
    expect(getEventDescriptor('unknown.event', 1)).toBeUndefined()
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
