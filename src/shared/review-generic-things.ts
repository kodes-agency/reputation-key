// Words that are no `thing` (annotation guide v3.3, rule 3). Each stands for the whole
// business, the visit, the people as a whole or the topic itself, so it names no specific
// object: the mention keeps its topic and its issue and has `thing` null. One list drives the
// prompt that says so and the check that no gold label of the evaluation set breaks the rule.
// A part or an item is still a thing ("overpriced drinks", "cold room", "loud music"), and so
// is another facility than the one reviewed ("the hotel restaurant" in a hotel's review).

export const REVIEW_GENERIC_THING_WORDS = Object.freeze({
  premises: Object.freeze([
    'place',
    'venue',
    'space',
    'setting',
    'surroundings',
    'house',
  ]),
  /** The type of business being reviewed: "the salon was clean" names no part of it. */
  businessType: Object.freeze(['hotel', 'restaurant', 'salon', 'studio', 'gym', 'spa']),
  visit: Object.freeze(['visit', 'stay', 'experience']),
  people: Object.freeze(['staff', 'team', 'service', 'welcome', 'greeting']),
  topic: Object.freeze([
    'price',
    'cost',
    'value',
    'wait',
    'atmosphere',
    'ambience',
    'vibe',
    'mood',
  ]),
})

const GENERIC_THING_WORD_SET: ReadonlySet<string> = new Set(
  Object.values(REVIEW_GENERIC_THING_WORDS).flat(),
)

/** Whether a stored or labelled `thing` is exactly one of the generic placeholder words. */
export function isGenericThingWord(thing: string | null): boolean {
  return thing !== null && GENERIC_THING_WORD_SET.has(thing)
}
