// Word lists of the street-address markers (`ai-address-markers.ts`).
//
// A house number, a few words and a street-type word is an address only when
// the words read as a street's name and not as a clause of a review. These
// lists are the evidence the reading uses. Every one of them is part of the
// detector profile digest, so editing a list moves the digest.
//
// The lists are deliberately split by how sure a word is. A word that no street
// is named after (`was`, `to`, `minutes`) rules the candidate out in any case.
// A word that is also a real street name (`mile`, `star`, `down`, `love`) only
// rules out a name typed in lower case, where nothing else says "a street".

/**
 * Things a guest counts or measures, in the plural or as a unit symbol. A number
 * followed by one of them is a quantity (`3 nights`, `2 Minutes`, `100 percent`),
 * never a house number. The singular `minute`, `hour`, `min` and `hr` belong here
 * too (`a 10 Minute Drive`): no street is named after them.
 */
export const QUANTITY_WORDS: readonly string[] = Object.freeze([
  'bedrooms',
  'beds',
  'blocks',
  'bucks',
  'cents',
  'cm',
  'courses',
  'days',
  'dollars',
  'euros',
  'feet',
  'floors',
  'gb',
  'guests',
  'hour',
  'hours',
  'hr',
  'hrs',
  'kg',
  'km',
  'kms',
  'lanes',
  'leva',
  'mb',
  'mbps',
  'meters',
  'metres',
  'miles',
  'min',
  'mins',
  'minute',
  'minutes',
  'months',
  'nights',
  'people',
  'percent',
  'persons',
  'pounds',
  'rooms',
  'sqm',
  'stars',
  'steps',
  'times',
  'weeks',
  'yards',
  'years',
])

/** Spans of time. In the plural they rule a candidate out wherever they sit. */
export const TIME_UNIT_WORDS: readonly string[] = Object.freeze([
  'days',
  'hours',
  'hrs',
  'mins',
  'minutes',
  'months',
  'nights',
  'weeks',
  'years',
])

/**
 * Counted things in the singular: `a 5 star place`, `a 2 bedroom place`, `a 3 day
 * drive`. They are also real street names (`Mile End Road`, `Star Street`,
 * `Pound Lane`), so they only rule out a lower-case name before an everyday
 * street word.
 */
export const SOFT_UNIT_WORDS: readonly string[] = Object.freeze([
  'bed',
  'bedroom',
  'block',
  'buck',
  'cent',
  'day',
  'dollar',
  'door',
  'euro',
  'floor',
  'guest',
  'lev',
  'meter',
  'metre',
  'mile',
  'month',
  'night',
  'person',
  'pound',
  'room',
  'star',
  'step',
  'time',
  'week',
  'year',
])

/**
 * The glue of a sentence: pronouns, auxiliaries, conjunctions and the
 * prepositions no street's name contains. `10 for this place`, `305 was a great
 * place`, `5 steps from the street`. They rule a candidate out in any case.
 */
export const STRONG_GLUE_WORDS: readonly string[] = Object.freeze([
  'about',
  'am',
  'are',
  'as',
  'at',
  'be',
  'been',
  'but',
  'by',
  'can',
  'could',
  'did',
  'do',
  'does',
  'for',
  'from',
  'had',
  'has',
  'have',
  'he',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'just',
  'might',
  'must',
  'no',
  'not',
  'on',
  'or',
  'she',
  'should',
  'so',
  'than',
  'then',
  'they',
  'to',
  'too',
  'very',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'with',
  'would',
  'you',
])

/**
 * Articles, determiners, possessives and prepositions of place. A few real
 * streets carry them (`Down Street`, `Our Lady's Road`, `All Saints Way`, `Under
 * Hill`), so they only rule out a name typed in lower case, and not a lone one
 * before a street word that is rarely anything else: `12 down street`.
 * `2 doors down the road`, `100 percent the way` stay prose.
 */
export const WEAK_GLUE_WORDS: readonly string[] = Object.freeze([
  'a',
  'above',
  'across',
  'after',
  'all',
  'along',
  'an',
  'and',
  'any',
  'around',
  'away',
  'before',
  'behind',
  'below',
  'beside',
  'between',
  'down',
  'each',
  'every',
  'her',
  'his',
  'its',
  'lane',
  'lanes',
  'more',
  'my',
  'near',
  'off',
  'only',
  'other',
  'our',
  'out',
  'over',
  'past',
  'per',
  'same',
  'that',
  'their',
  'these',
  'this',
  'those',
  'through',
  'towards',
  'under',
  'up',
  'upon',
  'way',
  'ways',
  'your',
])

/**
 * Praise and complaint, applied to a lower-case name before an everyday street
 * word (`10 great place`) and to a capitalised one only when the number reads as
 * a rating (`10/10 GREAT PLACE`, `Ten Great Place`). A street called `Great
 * Court` or `Love Lane` is common enough to keep.
 */
export const EVALUATIVE_WORDS: readonly string[] = Object.freeze([
  'amazing',
  'awesome',
  'awful',
  'bad',
  'beautiful',
  'best',
  'clean',
  'central',
  'charming',
  'cheap',
  'comfortable',
  'cosy',
  'cozy',
  'decent',
  'dirty',
  'enjoyed',
  'excellent',
  'expensive',
  'fabulous',
  'fantastic',
  'friendly',
  'good',
  'great',
  'helpful',
  'horrible',
  'kind',
  'love',
  'loved',
  'lovely',
  'modern',
  'nice',
  'noisy',
  'perfect',
  'polite',
  'quiet',
  'recommend',
  'recommended',
  'relaxing',
  'spacious',
  'stay',
  'stayed',
  'super',
  'superb',
  'terrible',
  'visit',
  'visited',
  'wonderful',
  'worst',
  'worth',
])

/** Lower-case words that sit inside a proper street name. */
export const NAME_CONNECTOR_WORDS: readonly string[] = Object.freeze([
  'al',
  'and',
  'da',
  'de',
  'del',
  'della',
  'den',
  'der',
  'des',
  'di',
  'du',
  'el',
  'het',
  'la',
  'le',
  'les',
  'of',
  'the',
  'van',
  'von',
])

/** The street types the first detector knew, case-insensitive: the types of `12 Oak Road`. */
export const BASE_STREET_TYPE_WORDS: readonly string[] = Object.freeze([
  'avenue',
  'ave',
  'blvd',
  'boulevard',
  'ct',
  'court',
  'dr',
  'drive',
  'lane',
  'ln',
  'pl',
  'place',
  'rd',
  'road',
  'st',
  'street',
  'way',
])

/**
 * Street types beyond the thirteen the first detector knew (`12 Oak Close`, `5
 * Rose Crescent`, `7 Elm Gardens`). Several are ordinary English words (`close`,
 * `walk`, `row`, `square`), so a street ends in one only when it is written the
 * way a proper name is: the type and every word of the name capitalised.
 */
export const EXTRA_STREET_TYPE_WORDS: readonly string[] = Object.freeze([
  'alley',
  'approach',
  'cir',
  'circle',
  'close',
  'cres',
  'crescent',
  'gardens',
  'gdns',
  'grove',
  'highway',
  'hwy',
  'loop',
  'mews',
  'parkway',
  'pkwy',
  'plaza',
  'row',
  'sq',
  'square',
  'ter',
  'terrace',
  'trail',
  'walk',
])

/**
 * Street-type words that are also everyday words, and so how strictly a
 * lower-case name before them is judged. A great PLACE and a 2 bedroom PLACE are
 * praise and a count; a 3 day DRIVE and a 10 mile DRIVE are a count; `all the
 * WAY`, `the WAY back` and a lone `this PLACE` are a clause. A LANE or a COURT
 * is rarely any of those, and nobody writes `pl` or `dr` for the everyday word,
 * so `12 love lane`, `3 star court` and `12 mile dr` are addresses.
 */
export const EVALUATIVE_STREET_TYPES: readonly string[] = Object.freeze([
  'place',
  ...EXTRA_STREET_TYPE_WORDS,
])
export const UNIT_STREET_TYPES: readonly string[] = Object.freeze(['drive', 'place'])
export const CLAUSE_STREET_TYPES: readonly string[] = Object.freeze([
  'drive',
  'way',
  'place',
  ...EXTRA_STREET_TYPE_WORDS,
])

/**
 * Words that stand alone as a street's name in lower case (`12 down street`,
 * `10 the avenue`) because a few streets are named so. Other glue words
 * (`1 more street`, `1 other street`, `2 lane road`, `2 way street`) are prose.
 */
export const LONE_NAME_WORDS: readonly string[] = Object.freeze([
  'after',
  'before',
  'down',
  'my',
  'near',
  'off',
  'our',
  'out',
  'over',
  'past',
  'that',
  'the',
  'their',
  'this',
  'under',
  'up',
  'your',
])

/**
 * Abbreviations a guest types in lower case with a full stop (`n. main st`,
 * `mt. vernon road`, `st. john's street`). A single letter with a full stop
 * counts too. Any other word that ends in a full stop ends a sentence.
 */
export const LOWER_CASE_ABBREVIATIONS: readonly string[] = Object.freeze([
  'capt',
  'col',
  'dr',
  'ft',
  'gen',
  'gov',
  'hon',
  'jr',
  'lt',
  'mr',
  'mrs',
  'ms',
  'mt',
  'ne',
  'nw',
  'pres',
  'prof',
  'rev',
  'se',
  'sen',
  'sgt',
  'sr',
  'st',
  'ste',
  'sw',
])

/**
 * Prepositions of place and the determiners that follow them: `NEAR THE
 * STREET`, `ALONG THE ROAD`, `OVERLOOKING THE`. A capitalised name that opens
 * with one of these and then a determiner is a clause in capitals, not `All
 * Saints Way` or `Up Hill Drive`.
 */
export const PLACE_PREPOSITION_WORDS: readonly string[] = Object.freeze([
  'above',
  'across',
  'after',
  'along',
  'around',
  'away',
  'before',
  'behind',
  'below',
  'beside',
  'between',
  'down',
  'near',
  'off',
  'out',
  'over',
  'past',
  'through',
  'towards',
  'under',
  'up',
  'upon',
])

export const DETERMINER_WORDS: readonly string[] = Object.freeze([
  'a',
  'an',
  'her',
  'his',
  'its',
  'my',
  'our',
  'that',
  'the',
  'their',
  'these',
  'this',
  'those',
  'your',
])

/**
 * Words in front of a number that make it a rating or a rank: `Top 10 Best
 * Place`, `No. 1 Great Place`, `Rating 10 Great Place`.
 */
export const RATING_LEAD_WORDS: readonly string[] = Object.freeze([
  'atmosphere',
  'breakfast',
  'cleanliness',
  'comfort',
  'food',
  'gave',
  'give',
  'location',
  'no.',
  'nr.',
  'number',
  'overall',
  'rated',
  'rating',
  'score',
  'scored',
  'service',
  'staff',
  'top',
  'value',
  'wifi',
])

/**
 * Words that cannot stand in front of a house number: `a 2 Bedroom Place`, `the
 * 5 Star Place`. A number after an article or a possessive is a count.
 */
export const COUNT_LEAD_WORDS: readonly string[] = Object.freeze([
  'a',
  'an',
  'another',
  'each',
  'every',
  'her',
  'his',
  'its',
  'my',
  'our',
  'that',
  'the',
  'their',
  'these',
  'this',
  'those',
  'your',
])

/**
 * Words that introduce an address: `We stayed at 12 love place`. A number after
 * one of them is a house number, so the everyday words a lower-case name holds
 * (`love`, `star`, `mile`, `way`) are the name of a street and not the praise or
 * the count they are in prose (`a 5 star place`). The same holds for a number
 * within three words of a label (`The hotel address is 19 six mile place`).
 * `to` and `from` are left out: `taxi to 12 mile drive area` is prose.
 */
export const ADDRESS_LEAD_WORDS: readonly string[] = Object.freeze(['at'])
export const ADDRESS_LABEL_WORDS: readonly string[] = Object.freeze([
  'addr',
  'address',
  'addresses',
  'adress',
])

/**
 * Prepositions inside a place's name, between two of its words: `Henley on
 * Thames Road`, `Sutton in Ashfield Road`, `Stratford upon Avon Way`. No other
 * word of the strong glue list is part of a street's name.
 */
export const NAME_PREPOSITION_WORDS: readonly string[] = Object.freeze([
  'at',
  'by',
  'in',
  'on',
  'upon',
])

/**
 * A number written after a street is a count, not a house number, when one of
 * these follows it: `Station Road 2 stops`, `Main Street 3 am`, `10 out of 10`.
 */
export const COUNT_FOLLOWER_WORDS: readonly string[] = Object.freeze([
  'am',
  'o',
  'out',
  'pm',
  'stop',
  'stops',
])

/**
 * Street-type words of other languages that are typed in lower case before the
 * name (`12 rue de la Paix`). `via` is left out: it is an English preposition
 * (`50 via PayPal`), and is read only as `Via Roma`.
 */
export const FOREIGN_LOWER_CASE_TYPE_WORDS: readonly string[] = Object.freeze([
  'allee',
  'allée',
  'avenida',
  'calle',
  'camino',
  'carrer',
  'chemin',
  'corso',
  'paseo',
  'piazza',
  'plac',
  'quai',
  'rua',
  'rue',
  'strada',
  'ul',
  'ulica',
  'viale',
])

/** Particles inside the name of a street of another language. */
export const FOREIGN_NAME_PARTICLE_WORDS: readonly string[] = Object.freeze([
  'al',
  'da',
  'das',
  'de',
  'dei',
  'del',
  'della',
  'dello',
  'den',
  'der',
  'des',
  'di',
  'do',
  'dos',
  'du',
  'e',
  'el',
  'het',
  'la',
  'le',
  'les',
  'van',
  'von',
  'y',
])

/**
 * Words that may stand in the value of an address label though they are not
 * capitalised names: the labels of a number (`No.`, `house`, `flat`) and the
 * abbreviations of an address (`str.`, `ul.`, `rd`).
 */
export const LABEL_QUALIFIER_WORDS: readonly string[] = Object.freeze([
  'ap',
  'apartment',
  'apt',
  'ave',
  'bl',
  'block',
  'blvd',
  'cad',
  'dr',
  'ent',
  'entrance',
  'et',
  'flat',
  'floor',
  'haus',
  'house',
  'hs',
  'n°',
  'no',
  'nr',
  'nº',
  'pl',
  'rd',
  'sk',
  'sq',
  'st',
  'str',
  'ul',
  '№',
])

/**
 * Capitalised words that end the value of an address label: the sentence that
 * follows the address (`We loved it`, `Great hotel`), not part of it.
 */
export const LABEL_STOP_WORDS: readonly string[] = Object.freeze([
  'also',
  'amazing',
  'and',
  'are',
  'awesome',
  'best',
  'but',
  'clean',
  'excellent',
  'fantastic',
  'good',
  'great',
  'he',
  'here',
  'i',
  'is',
  'it',
  'love',
  'loved',
  'lovely',
  'my',
  'nice',
  'our',
  'perfect',
  'quiet',
  'she',
  'so',
  'thank',
  'thanks',
  'that',
  'their',
  'there',
  'they',
  'this',
  'very',
  'was',
  'we',
  'were',
  'wonderful',
  'you',
])

/**
 * Generic nouns of a hotel stay and street words: not the whole name of a street
 * in front of a street word (`Hotel Drive 2 beach`, `Boulevard Plaza 3`).
 */
export const GENERIC_NAME_WORDS: readonly string[] = Object.freeze([
  'apartment',
  'apartments',
  'avenue',
  'boulevard',
  'hostel',
  'hotel',
  'motel',
  'pool',
  'resort',
  'restaurant',
  'road',
  'room',
  'rooms',
  'street',
  'suite',
])

/** House numbers a guest writes out, for `Twelve Oak Road`. */
export const NUMBER_WORDS: readonly string[] = Object.freeze([
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
  'hundred',
])

export const QUANTITIES: ReadonlySet<string> = new Set(QUANTITY_WORDS)
export const TIME_UNITS: ReadonlySet<string> = new Set(TIME_UNIT_WORDS)
export const SOFT_UNITS: ReadonlySet<string> = new Set(SOFT_UNIT_WORDS)
export const STRONG_GLUE: ReadonlySet<string> = new Set(STRONG_GLUE_WORDS)
export const WEAK_GLUE: ReadonlySet<string> = new Set(WEAK_GLUE_WORDS)
export const EVALUATIVES: ReadonlySet<string> = new Set(EVALUATIVE_WORDS)
export const CONNECTORS: ReadonlySet<string> = new Set(NAME_CONNECTOR_WORDS)
export const EVALUATIVE_TYPES: ReadonlySet<string> = new Set(EVALUATIVE_STREET_TYPES)
export const UNIT_TYPES: ReadonlySet<string> = new Set(UNIT_STREET_TYPES)
export const CLAUSE_TYPES: ReadonlySet<string> = new Set(CLAUSE_STREET_TYPES)
export const LONE_NAMES: ReadonlySet<string> = new Set(LONE_NAME_WORDS)
export const PLACE_PREPOSITIONS: ReadonlySet<string> = new Set(PLACE_PREPOSITION_WORDS)
export const DETERMINERS: ReadonlySet<string> = new Set(DETERMINER_WORDS)
export const RATING_LEADS: ReadonlySet<string> = new Set(RATING_LEAD_WORDS)
export const COUNT_LEADS: ReadonlySet<string> = new Set(COUNT_LEAD_WORDS)
export const ABBREVIATIONS: ReadonlySet<string> = new Set(LOWER_CASE_ABBREVIATIONS)
export const ADDRESS_LEADS: ReadonlySet<string> = new Set(ADDRESS_LEAD_WORDS)
export const ADDRESS_LABELS: ReadonlySet<string> = new Set(ADDRESS_LABEL_WORDS)
export const NAME_PREPOSITIONS: ReadonlySet<string> = new Set(NAME_PREPOSITION_WORDS)
export const EXTRA_STREET_TYPES: ReadonlySet<string> = new Set(EXTRA_STREET_TYPE_WORDS)
export const COUNT_FOLLOWERS: ReadonlySet<string> = new Set(COUNT_FOLLOWER_WORDS)
export const GENERIC_NAMES: ReadonlySet<string> = new Set(GENERIC_NAME_WORDS)
export const BASE_STREET_TYPES: ReadonlySet<string> = new Set(BASE_STREET_TYPE_WORDS)
