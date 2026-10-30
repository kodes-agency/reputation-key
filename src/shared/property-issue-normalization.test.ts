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
  it('singularizes the explicit plural head words', () => {
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

  it.each([
    ['towels', 'towel'],
    ['showers', 'shower'],
    ['treadmills', 'treadmill'],
    ['life jackets', 'life jacket'],
    ['sun loungers', 'sun lounger'],
    ['breakfast eggs', 'breakfast egg'],
    ['answers', 'answer'],
    ['dumbbells', 'dumbbell'],
    ['keys', 'key'],
    ['tvs', 'tv'],
    ['check-ins', 'check-in'],
    ['facilities', 'facility'],
    ['amenities', 'amenity'],
    ['toiletries', 'toiletry'],
    ['pastries', 'pastry'],
    ['dishes', 'dish'],
    ['sandwiches', 'sandwich'],
    ['boxes', 'box'],
    ['classes', 'class'],
    ['glasses', 'glass'],
    ['mattresses', 'mattress'],
    ['houses', 'house'],
    ['courses', 'course'],
    ['shoes', 'shoe'],
    ['buses', 'bus'],
    ['menus', 'menu'],
    ['cookies', 'cookie'],
    ['smoothies', 'smoothie'],
    ['pies', 'pie'],
    ['potatoes', 'potato'],
    ['tomatoes', 'tomato'],
    ['knives', 'knife'],
    ['shelves', 'shelf'],
    ['children', 'child'],
  ] as const)(
    'singularizes the last word of %s by the plural rule',
    (plural, singular) => {
      expect(normalizeIssueThing('facilities_equipment', plural).memberKey).toBe(singular)
    },
  )

  it('applies the plural rule to the last word only, and to the last part of a hyphenated word', () => {
    expect(normalizeIssueThing('food_drink', 'tacos shell').memberKey).toBe('tacos shell')
    expect(normalizeIssueThing('food_drink', 'pizzas').memberKey).toBe('pizza')
    expect(normalizeIssueThing('facilities_equipment', 'bath towels').memberKey).toBe(
      'bath towel',
    )
    expect(normalizeIssueThing('speed_waiting', 'self-service check-ins').memberKey).toBe(
      'self-service check-in',
    )
  })

  it.each([
    'glass',
    'bus',
    'gas',
    'news',
    'stairs',
    'series',
    'premises',
    'scissors',
    'sunglasses',
    'lens',
    'canvas',
    'bonus',
    'tennis',
    'wellness',
    'wifi',
    'sauna',
  ] as const)('leaves %s as written: it is not a plural', (word) => {
    expect(normalizeIssueThing('facilities_equipment', word).memberKey).toBe(word)
  })

  it('treats the plural and the singular of one thing as one key in every topic', () => {
    for (const topic of REVIEW_TOPICS_V3) {
      expect(normalizeIssueThing(topic, 'showers')).toEqual(
        normalizeIssueThing(topic, 'shower'),
      )
    }
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

  it.each([
    ['staff_service', 'server', 'waiter'],
    ['staff_service', 'servers', 'waiter'],
    ['staff_service', 'waitress', 'waiter'],
    ['staff_service', 'front desk clerk', 'front desk'],
    ['staff_service', 'front desk staff', 'front desk'],
    ['staff_service', 'desk staff', 'front desk'],
    ['staff_service', 'reception staff', 'front desk'],
    ['staff_service', 'massage therapist', 'therapist'],
    ['staff_service', 'masseur', 'therapist'],
    ['staff_service', 'hairdresser', 'stylist'],
    ['atmosphere_noise', 'ambience', 'atmosphere'],
    ['atmosphere_noise', 'ambiance', 'atmosphere'],
    ['atmosphere_noise', 'ambiente', 'atmosphere'],
    ['atmosphere_noise', 'vibe', 'atmosphere'],
    ['atmosphere_noise', 'crowding', 'crowd'],
    ['atmosphere_noise', 'scent', 'smell'],
    ['atmosphere_noise', 'playlist', 'music'],
    ['facilities_equipment', 'outboard motor', 'engine'],
    ['facilities_equipment', 'outboard engine', 'engine'],
    ['facilities_equipment', 'motor', 'engine'],
    ['facilities_equipment', 'electrical socket', 'wall socket'],
    ['facilities_equipment', 'lat pulldown machine', 'lat pulldown'],
    ['facilities_equipment', 'wi-fi', 'wifi'],
    ['facilities_equipment', 'television', 'tv'],
    ['facilities_equipment', 'elevator', 'lift'],
    ['speed_waiting', 'pick-up', 'pickup'],
    ['speed_waiting', 'assistance', 'help'],
    ['main_service', 'blow-dry', 'blow dry'],
    ['main_service', 'hair colouring', 'hair colour'],
    ['main_service', 'hair color', 'hair colour'],
    ['food_drink', 'appetizer', 'starter'],
    ['communication', 'allergen warning', 'allergy warning'],
    ['staff_service', 'desk', 'front desk'],
    ['staff_service', 'dock attendant', 'attendant'],
    ['booking_arrival', 'phone booking', 'booking'],
    ['speed_waiting', 'staff attention', 'attention'],
    ['speed_waiting', 'session start', 'session'],
    ['communication', 'written complaint', 'complaint'],
    ['communication', 'questions', 'answer'],
    ['communication', 'staff answers', 'answer'],
    ['communication', 'response', 'answer'],
  ] as const)(
    'folds %s "%s" into "%s" for the same thing named two ways',
    (topic, alias, canonical) => {
      expect(normalizeIssueThing(topic, alias).canonicalKey).toBe(canonical)
      expect(normalizeIssueThing(topic, canonical).canonicalKey).toBe(canonical)
    },
  )

  it('does not fold a part into its whole: a balcony railing is not every railing', () => {
    expect(normalizeIssueThing('safety', 'balcony railing').canonicalKey).toBe(
      'balcony railing',
    )
    expect(
      normalizeIssueThing('facilities_equipment', 'balcony railing').canonicalKey,
    ).toBe('balcony railing')
  })

  it('keeps a synonym inside its topic', () => {
    expect(normalizeIssueThing('communication', 'server').canonicalKey).toBe('server')
    expect(normalizeIssueThing('staff_service', 'engine').canonicalKey).toBe('engine')
    expect(normalizeIssueThing('main_service', 'ambience').canonicalKey).toBe('ambience')
  })

  it('compares a gold label and an answer through the same key', () => {
    // The scorer passes both sides through this one function (scripts/evaluation).
    const pairs = [
      ['staff_service', 'waiter', 'server'],
      ['facilities_equipment', 'engine', 'outboard motor'],
      ['facilities_equipment', 'treadmill', 'treadmills'],
      ['staff_service', 'front desk', 'front desk clerk'],
    ] as const
    for (const [topic, gold, answer] of pairs) {
      expect(normalizeIssueThing(topic, gold).canonicalKey).toBe(
        normalizeIssueThing(topic, answer).canonicalKey,
      )
    }
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

  it('writes every alias in the form the plural rule leaves alone, so no entry is dead', () => {
    for (const [topic, entries] of Object.entries(catalogue.synonyms)) {
      for (const alias of Object.keys(entries)) {
        expect(
          normalizeIssueThing(topic as (typeof REVIEW_TOPICS_V3)[number], alias)
            .memberKey,
          `${topic}: ${alias}`,
        ).toBe(alias)
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
      ruleVersion: 'property-issue-normalization-rules-v2',
      digest: PROPERTY_ISSUE_NORMALIZATION_DIGEST,
    })
    expect(PROPERTY_ISSUE_NORMALIZATION_DIGEST).toMatch(/^[0-9a-f]{64}$/u)
  })
})
