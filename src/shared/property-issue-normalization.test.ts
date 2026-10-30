import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REVIEW_CAUSE_PHRASE_PATTERN } from './review-analysis-v3'
import { REVIEW_TOPICS_V3 } from './review-topic-taxonomy'
import {
  PROPERTY_ISSUE_NORMALIZATION_DIGEST,
  PROPERTY_ISSUE_NORMALIZATION_VERSION,
  TOPIC_LEVEL_ISSUE_KEY,
  normalizeIssueThing,
} from './property-issue-normalization'

const manifest = JSON.parse(
  readFileSync(
    join(import.meta.dirname, 'property-issue-normalization-v1.manifest.json'),
    'utf8',
  ),
) as Readonly<{ version: string; ruleVersion: string; digest: string }>

const catalogue = JSON.parse(
  readFileSync(join(import.meta.dirname, 'property-issue-normalization-v1.json'), 'utf8'),
) as Readonly<{
  singularization: Readonly<Record<string, string>>
  synonyms: Readonly<Record<string, Readonly<Record<string, string>>>>
}>

describe('property issue normalization', () => {
  it('normalizes the explicit plural head words only', () => {
    expect(normalizeIssueThing('cleanliness', 'Rooms')).toEqual({
      memberKey: 'room',
      canonicalKey: 'room',
      canonicalThing: 'room',
    })
    expect(normalizeIssueThing('speed_waiting', 'queues')).toEqual({
      memberKey: 'queue',
      canonicalKey: 'queue',
      canonicalThing: 'queue',
    })
    expect(normalizeIssueThing('safety', 'seat belts').memberKey).toBe('seat belt')
  })

  it('applies only exact topic-scoped synonyms', () => {
    for (const value of ['ac', 'air con'] as const) {
      expect(normalizeIssueThing('facilities_equipment', value).canonicalKey).toBe(
        'air conditioning',
      )
    }
    expect(normalizeIssueThing('price_billing', 'invoice').canonicalKey).toBe('bill')
    for (const value of ['telephone', 'phone line'] as const) {
      expect(normalizeIssueThing('communication', value).canonicalKey).toBe('phone')
    }
    expect(normalizeIssueThing('main_service', 'ac').canonicalKey).toBe('ac')
    expect(normalizeIssueThing('staff_service', 'telephone').canonicalKey).toBe(
      'telephone',
    )
  })

  it('keeps booking phrases and ambiguous endings distinct', () => {
    expect(normalizeIssueThing('booking_arrival', 'check in').canonicalKey).toBe(
      'check in',
    )
    expect(normalizeIssueThing('booking_arrival', 'check-in desk').canonicalKey).toBe(
      'check-in desk',
    )
    for (const value of ['glass', 'bus', 'news', 'stairs', 'wifi'] as const) {
      expect(normalizeIssueThing('facilities_equipment', value).canonicalKey).toBe(value)
    }
  })

  it('normalizes compatibility forms, punctuation, apostrophes, dashes and space', () => {
    expect(normalizeIssueThing('facilities_equipment', '  (ＡＩＲ—ＣＯＮ)  ')).toEqual({
      memberKey: 'air-con',
      canonicalKey: 'air-con',
      canonicalThing: 'air-con',
    })
    expect(normalizeIssueThing('cleanliness', '“rooms”').canonicalKey).toBe('room')
  })

  it('uses a content-free sentinel for a topic-level mention', () => {
    expect(normalizeIssueThing('cleanliness', null)).toEqual({
      memberKey: TOPIC_LEVEL_ISSUE_KEY,
      canonicalKey: TOPIC_LEVEL_ISSUE_KEY,
      canonicalThing: null,
    })
  })

  it('refuses a phrase outside the stored cause contract', () => {
    expect(() => normalizeIssueThing('main_service', 'four word object phrase')).toThrow(
      'Property issue thing does not fit the stored cause phrase contract',
    )
    expect(() => normalizeIssueThing('main_service', 'a/c')).toThrow(
      'Property issue thing does not fit the stored cause phrase contract',
    )
  })

  it('is idempotent for every canonical key in the governed synonym table', () => {
    for (const [topic, entries] of Object.entries(catalogue.synonyms)) {
      for (const canonicalKey of Object.values(entries)) {
        expect(
          normalizeIssueThing(topic as (typeof REVIEW_TOPICS_V3)[number], canonicalKey),
        ).toMatchObject({ memberKey: canonicalKey, canonicalKey })
      }
    }
  })

  it('keeps every governed key and value inside the cause phrase contract', () => {
    for (const [plural, singular] of Object.entries(catalogue.singularization)) {
      expect(REVIEW_CAUSE_PHRASE_PATTERN.test(plural), plural).toBe(true)
      expect(REVIEW_CAUSE_PHRASE_PATTERN.test(singular), singular).toBe(true)
    }
    for (const entries of Object.values(catalogue.synonyms)) {
      for (const [alias, canonical] of Object.entries(entries)) {
        expect(REVIEW_CAUSE_PHRASE_PATTERN.test(alias), alias).toBe(true)
        expect(REVIEW_CAUSE_PHRASE_PATTERN.test(canonical), canonical).toBe(true)
      }
    }
  })

  it('has no synonym chains or cycles', () => {
    for (const entries of Object.values(catalogue.synonyms)) {
      for (const canonical of Object.values(entries)) {
        expect(entries[canonical], canonical).toBeUndefined()
      }
    }
  })

  it('pins the reviewed catalogue digest in its manifest', () => {
    expect(PROPERTY_ISSUE_NORMALIZATION_VERSION).toBe('property-issue-normalization-v1')
    expect(manifest).toEqual({
      version: PROPERTY_ISSUE_NORMALIZATION_VERSION,
      ruleVersion: 'property-issue-normalization-rules-v1',
      digest: PROPERTY_ISSUE_NORMALIZATION_DIGEST,
    })
    expect(PROPERTY_ISSUE_NORMALIZATION_DIGEST).toMatch(/^[0-9a-f]{64}$/u)
  })
})
