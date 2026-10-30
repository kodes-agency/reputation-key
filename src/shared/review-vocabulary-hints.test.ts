import { afterEach, describe, expect, it, vi } from 'vitest'
import catalogue from './review-vocabulary-hints-v1.json'
import manifest from './review-vocabulary-hints-v1.manifest.json'
import { collectVocabularyHintWords } from './review-analysis-v3-cause-rules'
import { REVIEW_GENERIC_THING_WORDS } from './review-generic-things'
import {
  GENERIC_VOCABULARY_HINT_SET_ID,
  REVIEW_PROPERTY_CONTEXT_MAX_BYTES,
  REVIEW_VOCABULARY_HINTS_CATALOGUE_DIGEST,
  REVIEW_VOCABULARY_HINTS_VERSION,
  VOCABULARY_HINTS_MAX_PER_SET,
  VOCABULARY_HINTS_MAX_PER_TOPIC,
  VOCABULARY_HINT_SETS,
  propertyContextMatchesHintIdentity,
  resolveReviewPropertyContext,
  reviewPropertyContextSchema,
  selectVocabularyHintSet,
  vocabularyHintIdentity,
  vocabularyHintSetDigest,
} from './review-vocabulary-hints'

const SET_IDS = [
  'lodging',
  'food-service',
  'beauty',
  'spa-wellness',
  'boat-water-activities',
  'tour-operator',
  'gym-fitness',
  GENERIC_VOCABULARY_HINT_SET_ID,
] as const

const setById = (id: string) => {
  const set = VOCABULARY_HINT_SETS.find((candidate) => candidate.id === id)
  if (!set) throw new Error(`no hint set ${id}`)
  return set
}

describe('the vocabulary hint catalogue', () => {
  it('holds the initial sets of the contract and the generic fallback', () => {
    expect(VOCABULARY_HINT_SETS.map((set) => set.id)).toEqual(SET_IDS)
    expect(new Set(VOCABULARY_HINT_SETS.map((set) => set.version))).toEqual(
      new Set([REVIEW_VOCABULARY_HINTS_VERSION]),
    )
    expect(setById(GENERIC_VOCABULARY_HINT_SET_ID).categoryAliases).toEqual([])
  })

  it('is pinned by its manifest, so an edit is a reviewed change', () => {
    const computed = {
      version: REVIEW_VOCABULARY_HINTS_VERSION,
      catalogueDigest: REVIEW_VOCABULARY_HINTS_CATALOGUE_DIGEST,
      sets: VOCABULARY_HINT_SETS.map((set) => ({
        id: set.id,
        digest: vocabularyHintSetDigest(set),
      })),
    }

    // On a failure the computed manifest is the new review-vocabulary-hints-v1.manifest.json.
    expect(JSON.stringify(manifest, null, 2), JSON.stringify(computed, null, 2)).toBe(
      JSON.stringify(computed, null, 2),
    )
  })

  it('suggests no generic word as a thing, which the prompt tells the model to leave null', () => {
    const generic = new Set(Object.values(REVIEW_GENERIC_THING_WORDS).flat())
    const found = VOCABULARY_HINT_SETS.flatMap((set) =>
      Object.entries(set.hints).flatMap(([topic, phrases]) =>
        phrases
          .filter((phrase) => generic.has(phrase))
          .map((phrase) => `${set.id}/${topic}/${phrase}`),
      ),
    )
    // A hotel's restaurant is another facility than the business reviewed (the guide, rule 3).
    expect(found).toEqual(['lodging/food_drink/restaurant'])
  })

  it('keeps every set inside the prompt budget', () => {
    for (const set of VOCABULARY_HINT_SETS) {
      const lists = Object.values(set.hints)
      expect(lists.length, set.id).toBeGreaterThan(0)
      for (const list of lists) {
        expect(list.length, set.id).toBeLessThanOrEqual(VOCABULARY_HINTS_MAX_PER_TOPIC)
      }
      expect(lists.flat().length, set.id).toBeLessThanOrEqual(
        VOCABULARY_HINTS_MAX_PER_SET,
      )
    }
  })

  it('gives every specific set the topics a guest of that business talks about', () => {
    for (const set of VOCABULARY_HINT_SETS) {
      for (const topic of [
        'staff_service',
        'cleanliness',
        'facilities_equipment',
        'price_billing',
        'communication',
      ] as const) {
        expect(set.hints[topic]?.length ?? 0, `${set.id} ${topic}`).toBeGreaterThan(0)
      }
    }
  })

  it('is immutable, so a request cannot change what the next one sends', () => {
    const lodging = setById('lodging')

    expect(Object.isFrozen(lodging)).toBe(true)
    expect(Object.isFrozen(lodging.hints)).toBe(true)
    expect(Object.isFrozen(lodging.hints.staff_service)).toBe(true)
    expect(Object.isFrozen(VOCABULARY_HINT_SETS)).toBe(true)
  })
})

describe('the catalogue loader refuses a catalogue that would send the wrong hints', () => {
  afterEach(() => {
    vi.doUnmock('./review-vocabulary-hints-v1.json')
    vi.resetModules()
  })

  async function importWith(edit: (copy: typeof catalogue) => void) {
    const copy = structuredClone(catalogue)
    edit(copy)
    vi.resetModules()
    vi.doMock('./review-vocabulary-hints-v1.json', () => ({ default: copy }))
    return import('./review-vocabulary-hints')
  }

  const lodging = (copy: typeof catalogue) => {
    const set = copy.sets[0]
    if (!set) throw new Error('no first set')
    return set
  }

  it('refuses an alias that two sets claim, whatever its case', async () => {
    await expect(
      importWith((copy) => {
        const food = copy.sets[1]
        if (!food) throw new Error('no second set')
        food.categoryAliases.push('hotel')
      }),
    ).rejects.toThrow(/belongs to lodging/u)
  })

  it('refuses a catalogue without the generic fallback', async () => {
    await expect(
      importWith((copy) => {
        copy.sets = copy.sets.filter((set) => set.id !== 'generic-service')
      }),
    ).rejects.toThrow(/generic-service/u)
  })

  it('refuses a hint that is not one to three lowercase words', async () => {
    for (const phrase of [
      'Air conditioning',
      'air conditioning unit upstairs',
      'room 12',
    ]) {
      await expect(
        importWith((copy) => {
          lodging(copy).hints.facilities_equipment.push(phrase)
        }),
      ).rejects.toThrow(/one to three lowercase words/u)
    }
  })

  it('refuses a repeated hint, too many under one topic, and an alias not in stored form', async () => {
    await expect(
      importWith((copy) => {
        lodging(copy).hints.staff_service.push('manager')
      }),
    ).rejects.toThrow(/repeats a hint/u)
    await expect(
      importWith((copy) => {
        lodging(copy).hints.staff_service = Array.from(
          { length: VOCABULARY_HINTS_MAX_PER_TOPIC + 1 },
          (_, index) => `role ${'abcdefghijklmnopqrstuvwxyz'[index]}`,
        )
      }),
    ).rejects.toThrow(/expected array to have <=16 items/u)
    await expect(
      importWith((copy) => {
        lodging(copy).categoryAliases.push(' Padded  alias ')
      }),
    ).rejects.toThrow(/stored form/u)
  })
})

describe('selectVocabularyHintSet', () => {
  const aliases = VOCABULARY_HINT_SETS.flatMap((set) =>
    set.categoryAliases.map((alias) => [alias, set.id] as const),
  )

  it('has aliases to choose by for every set but the fallback', () => {
    expect(aliases.length).toBeGreaterThan(50)
    for (const id of SET_IDS.filter((id) => id !== GENERIC_VOCABULARY_HINT_SET_ID)) {
      expect(setById(id).categoryAliases.length, id).toBeGreaterThan(0)
    }
  })

  it.each(aliases)('chooses by the Google display name %s', (alias, id) => {
    expect(selectVocabularyHintSet(alias).id).toBe(id)
  })

  it.each([
    ['Hotel', 'lodging'],
    ['Bed and breakfast', 'lodging'],
    ['Bed & breakfast', 'lodging'],
    ['Restaurant', 'food-service'],
    ['Sushi restaurant', 'food-service'],
    ['Beauty salon', 'beauty'],
    ['Hair salon', 'beauty'],
    ['Barber shop', 'beauty'],
    ['Day spa', 'spa-wellness'],
    ['Boat rental service', 'boat-water-activities'],
    ['Tour operator', 'tour-operator'],
    ['Gym', 'gym-fitness'],
  ])('maps the contract’s example %s to %s', (category, id) => {
    expect(selectVocabularyHintSet(category).id).toBe(id)
  })

  it('compares after NFKC, whitespace, trim and case-folding', () => {
    for (const written of [
      'HOTEL',
      '  hotel  ',
      'Ｈotel',
      'hOtEl',
      'bed  &\tbreakfast',
    ]) {
      expect(selectVocabularyHintSet(written).id, written).toBe('lodging')
    }
  })

  it('falls back to the generic set when there is nothing to choose by', () => {
    for (const category of [null, undefined, '', '   ', 'Accountant', 'Law firm']) {
      expect(selectVocabularyHintSet(category).id, String(category)).toBe(
        GENERIC_VOCABULARY_HINT_SET_ID,
      )
    }
  })

  it('never guesses from a part of a category', () => {
    // Containing a word that is an alias is not being it.
    for (const category of [
      'Sports bar',
      'Hotel bar',
      'Italian',
      'Restaurant supply store',
      'Hotel supply store',
      'Bars',
      'Spa hotel',
      'Pet boat dealer',
    ]) {
      expect(selectVocabularyHintSet(category).id, category).toBe(
        GENERIC_VOCABULARY_HINT_SET_ID,
      )
    }
    // "Barber shop" holds "bar" and is a barber's, not a bar.
    expect(selectVocabularyHintSet('Barber shop').id).toBe('beauty')
    expect(selectVocabularyHintSet('Bar').id).toBe('food-service')
  })

  it('keeps no alias in two sets', () => {
    const keys = aliases.map(([alias]) => alias.toLowerCase())

    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('hint identity and digests', () => {
  it('digests the id, version and hints, so editing a hint moves exactly that set', () => {
    const lodging = setById('lodging')
    const edited = {
      ...lodging,
      hints: {
        ...lodging.hints,
        staff_service: [...(lodging.hints.staff_service ?? []), 'valet'],
      },
    }

    expect(vocabularyHintSetDigest(edited)).not.toBe(vocabularyHintSetDigest(lodging))
    expect(vocabularyHintSetDigest(setById('beauty'))).toBe(
      manifest.sets.find((entry) => entry.id === 'beauty')?.digest,
    )
  })

  it('does not digest the aliases: choosing by one more name is not a new set of hints', () => {
    const lodging = setById('lodging')
    const withAnotherName = {
      ...lodging,
      categoryAliases: [...lodging.categoryAliases, 'Chalet'],
    }

    expect(vocabularyHintSetDigest(withAnotherName)).toBe(
      vocabularyHintSetDigest(lodging),
    )
  })

  it('records the set id, the version and the digest of what was sent', () => {
    const identity = vocabularyHintIdentity(setById('gym-fitness'))

    expect(identity).toEqual({
      setId: 'gym-fitness',
      setVersion: 'review-vocabulary-hints-v1',
      digest: vocabularyHintSetDigest(setById('gym-fitness')),
    })
    expect(identity.digest).toMatch(/^[0-9a-f]{64}$/u)
  })
})

describe('resolveReviewPropertyContext', () => {
  it('carries the category and the chosen set’s hints', () => {
    const { propertyContext, hintIdentity } = resolveReviewPropertyContext('Hair salon')

    expect(propertyContext).toEqual({
      googlePrimaryCategory: 'Hair salon',
      vocabularyHintSetId: 'beauty',
      vocabularyHintSetVersion: 'review-vocabulary-hints-v1',
      vocabularyHints: setById('beauty').hints,
    })
    expect(hintIdentity.setId).toBe('beauty')
  })

  it('sends the generic hints and no category when the Property has none', () => {
    for (const category of [null, undefined, '', 'Hotel\u0000']) {
      const { propertyContext } = resolveReviewPropertyContext(category)

      expect(propertyContext.googlePrimaryCategory, String(category)).toBeNull()
      expect(propertyContext.vocabularyHintSetId, String(category)).toBe(
        GENERIC_VOCABULARY_HINT_SET_ID,
      )
    }
  })

  it('sends the stored form of a category whose set is the fallback', () => {
    const { propertyContext } = resolveReviewPropertyContext('  Law   firm ')

    expect(propertyContext.googlePrimaryCategory).toBe('Law firm')
    expect(propertyContext.vocabularyHintSetId).toBe(GENERIC_VOCABULARY_HINT_SET_ID)
  })

  it.each(SET_IDS)('stays inside the request budget for %s', (id) => {
    const alias = setById(id).categoryAliases[0] ?? null
    const { propertyContext } = resolveReviewPropertyContext(alias)
    const bytes = new TextEncoder().encode(JSON.stringify(propertyContext)).byteLength

    expect(propertyContext.vocabularyHintSetId).toBe(id)
    expect(bytes).toBeLessThanOrEqual(REVIEW_PROPERTY_CONTEXT_MAX_BYTES)
  })

  it('is strict: a context with another key is not a property context', () => {
    const { propertyContext } = resolveReviewPropertyContext('Hotel')

    expect(reviewPropertyContextSchema.safeParse(propertyContext).success).toBe(true)
    expect(
      reviewPropertyContextSchema.safeParse({ ...propertyContext, propertyName: 'x' })
        .success,
    ).toBe(false)
    expect(
      reviewPropertyContextSchema.safeParse({
        ...propertyContext,
        vocabularyHints: { staff_service: ['Front Desk'] },
      }).success,
    ).toBe(false)
  })

  it('hands out a copy, so a request cannot change the catalogue', () => {
    const { propertyContext } = resolveReviewPropertyContext('Hotel')

    propertyContext.vocabularyHints.staff_service?.push('intruder')

    expect(setById('lodging').hints.staff_service).not.toContain('intruder')
    expect(
      resolveReviewPropertyContext('Hotel').propertyContext.vocabularyHints.staff_service,
    ).not.toContain('intruder')
  })

  it('gives the normalizer the words it lets a cause use', () => {
    const { propertyContext } = resolveReviewPropertyContext('Hotel')
    const words = collectVocabularyHintWords(propertyContext.vocabularyHints)

    expect(words.has('wifi')).toBe(true)
    expect(words.has('concierge')).toBe(true)
    expect(words.has('massage')).toBe(false)
  })
})

describe('propertyContextMatchesHintIdentity', () => {
  it('holds a request to the set its operation recorded', () => {
    const { propertyContext, hintIdentity } =
      resolveReviewPropertyContext('Boat rental service')

    expect(propertyContextMatchesHintIdentity(propertyContext, hintIdentity)).toBe(true)
  })

  it('refuses hints that changed after the operation was claimed', () => {
    const { propertyContext, hintIdentity } =
      resolveReviewPropertyContext('Boat rental service')
    const moved = {
      ...propertyContext,
      vocabularyHints: {
        ...propertyContext.vocabularyHints,
        staff_service: [
          ...(propertyContext.vocabularyHints.staff_service ?? []),
          'deckhand',
        ],
      },
    }

    expect(propertyContextMatchesHintIdentity(moved, hintIdentity)).toBe(false)
  })

  it('refuses another set’s hints under this identity', () => {
    const boat = resolveReviewPropertyContext('Boat rental service')
    const hotel = resolveReviewPropertyContext('Hotel')

    expect(
      propertyContextMatchesHintIdentity(hotel.propertyContext, boat.hintIdentity),
    ).toBe(false)
  })
})

describe('hints are request context, not analysis semantics', () => {
  afterEach(() => {
    vi.doUnmock('./review-vocabulary-hints-v1.json')
    vi.resetModules()
  })

  it('leaves the logical artifacts of an analysis, and so its runtime digest, alone when a hint changes', async () => {
    const before = await import('./review-analysis-v3-artifacts')
    const hintsBefore = await import('./review-vocabulary-hints')

    const edited = structuredClone(catalogue)
    edited.sets[0]?.hints.staff_service.push('valet')
    vi.resetModules()
    vi.doMock('./review-vocabulary-hints-v1.json', () => ({ default: edited }))
    const after = await import('./review-analysis-v3-artifacts')
    const hintsAfter = await import('./review-vocabulary-hints')

    expect(hintsAfter.REVIEW_VOCABULARY_HINTS_CATALOGUE_DIGEST).not.toBe(
      hintsBefore.REVIEW_VOCABULARY_HINTS_CATALOGUE_DIGEST,
    )
    expect(
      hintsAfter.vocabularyHintSetDigest(hintsAfter.selectVocabularyHintSet('Hotel')),
    ).not.toBe(
      hintsBefore.vocabularyHintSetDigest(hintsBefore.selectVocabularyHintSet('Hotel')),
    )
    expect(after.REVIEW_ANALYSIS_V3_LOGICAL_ARTIFACTS_DIGEST).toBe(
      before.REVIEW_ANALYSIS_V3_LOGICAL_ARTIFACTS_DIGEST,
    )
    expect(Object.keys(after.REVIEW_ANALYSIS_V3_LOGICAL_ARTIFACTS)).not.toContain(
      'vocabularyHintsDigest',
    )
  })
})
