// The words Share's warning list looks for in the manager's own call to action,
// per language (final design spec §5.8, `cta-research.md`). Data only; the
// matching is `portal-print-final-warnings.ts`. Whole words and phrases, matched
// with case and accents folded (the matcher folds these lists as it folds the
// typed text), so "Évaluez" and "evaluez" are one word. Every non-English form is
// a draft that needs a native check (slice C9).
//
// Only a clear offer blocks a print: Google removes reviews given for a discount
// or a gift. Everything else warns and never blocks. Two of the spec's offer
// words are also everyday words, French "bon" and Italian "buono" ("good"), so
// they count only in their offer phrases, "bon de réduction" and "buono sconto".

import type { GuestLocale } from './guest-locale'

export type PrintFinalWarningWords = Readonly<{
  /** Words and phrases that name an offer: they block. */
  offers: readonly string[]
  /** What "free" goes with to make an offer ("free dessert", "postre gratis"): free + thing blocks. */
  free: readonly string[]
  things: readonly string[]
  /** What follows "10 %" or "€5" to make it a discount ("off", "de descuento"). */
  off: readonly string[]
  /** An offer word alone: it only asks whether something is given for the review. */
  offerWords: readonly string[]
  /** Words that ask only happy guests. */
  mood: readonly string[]
  /** Pressure on the premises, and requests to name staff or say something. */
  pressure: readonly string[]
  /** Words about privacy, which can read as steering unhappy guests away. */
  privacy: readonly string[]
  /** Seconds and minutes: a number before one promises a time. */
  time: readonly string[]
}>

export const PRINT_FINAL_WARNING_WORDS: Readonly<
  Record<GuestLocale, PrintFinalWarningWords>
> = Object.freeze({
  en: {
    offers: [
      'discount',
      'discounts',
      'coupon',
      'coupons',
      'voucher',
      'vouchers',
      'promo code',
      'prize',
      'prizes',
      'chance to win',
      'win a',
      'win an',
    ],
    free: ['free'],
    things: [
      'drink',
      'drinks',
      'dessert',
      'desserts',
      'coffee',
      'coffees',
      'night',
      'nights',
      'meal',
      'meals',
      'appetizer',
      'appetizers',
      'upgrade',
      'upgrades',
      'gift',
      'gifts',
    ],
    off: ['off'],
    offerWords: ['free', 'gift', 'gifts', 'win', 'reward', 'rewards'],
    mood: [
      '5 stars',
      '5 star',
      'five stars',
      'five star',
      'positive',
      'great',
      'love',
      'loved',
      'enjoyed',
      'happy',
      'satisfied',
      'if you liked',
      'recommend',
    ],
    pressure: [
      'before you leave',
      "don't forget",
      'must',
      'mention',
      'ask for',
      'staff',
      'by name',
    ],
    privacy: ['private', 'privately', 'anonymous', 'anonymously', 'confidential'],
    time: ['second', 'seconds', 'sec', 'secs', 'minute', 'minutes', 'min', 'mins'],
  },
  es: {
    offers: ['descuento', 'descuentos', 'cupon', 'cupones', 'premio', 'premios'],
    free: ['gratis'],
    things: [
      'bebida',
      'postre',
      'cafe',
      'noche',
      'comida',
      'cena',
      'aperitivo',
      'regalo',
    ],
    off: ['de descuento'],
    offerWords: ['gratis', 'regalo'],
    mood: ['5 estrellas', 'positiva', 'positivo', 'si le gusto'],
    pressure: ['antes de irse', 'no olvide', 'mencione', 'pregunte por'],
    privacy: ['privado', 'privada', 'anonimo', 'anonima'],
    time: ['segundos', 'minutos'],
  },
  it: {
    offers: ['sconto', 'sconti', 'buono sconto', 'premio', 'premi'],
    free: ['gratis', 'in omaggio'],
    things: [
      'bevanda',
      'dolce',
      'dessert',
      'caffe',
      'notte',
      'pasto',
      'cena',
      'aperitivo',
    ],
    off: ['di sconto'],
    offerWords: ['gratis', 'regalo', 'omaggio'],
    mood: ['5 stelle', 'positiva', 'positivo', 'se le e piaciuto'],
    pressure: ['prima di andare', 'non dimentichi', 'menzioni', 'chieda di'],
    privacy: ['privato', 'privata', 'anonimo', 'anonima'],
    time: ['secondi', 'minuti'],
  },
  fr: {
    offers: ['reduction', 'reductions', 'bon de reduction', 'coupon', 'coupons'],
    free: ['offert', 'offerte', 'gratuit', 'gratuite'],
    things: ['boisson', 'dessert', 'cafe', 'nuit', 'repas', 'diner', 'aperitif'],
    off: ['de remise', 'de reduction'],
    offerWords: ['gratuit', 'gratuite', 'cadeau'],
    mood: ['5 etoiles', 'positif', 'positive', 'si vous avez aime'],
    pressure: ['avant de partir', "n'oubliez pas", 'mentionnez', 'demandez'],
    privacy: ['prive', 'privee', 'anonyme'],
    time: ['secondes', 'minutes'],
  },
  de: {
    offers: ['rabatt', 'gutschein', 'gutscheine', 'gewinnspiel'],
    free: ['gratis', 'kostenlos', 'kostenloser', 'kostenlose', 'kostenloses'],
    things: [
      'getrank',
      'dessert',
      'kaffee',
      'nacht',
      'essen',
      'abendessen',
      'vorspeise',
      'upgrade',
    ],
    off: ['rabatt'],
    offerWords: ['kostenlos', 'geschenk', 'gewinn'],
    mood: ['5 sterne', 'positiv', 'positive', 'wenn sie zufrieden'],
    pressure: ['bevor sie gehen', 'nicht vergessen', 'erwahnen sie', 'fragen sie nach'],
    privacy: ['privat', 'anonym', 'vertraulich'],
    time: ['sekunden', 'minuten'],
  },
  bg: {
    offers: ['отстъпка', 'отстъпки', 'ваучер', 'ваучери', 'награда', 'награди'],
    free: ['безплатен', 'безплатна', 'безплатно', 'безплатни'],
    things: ['напитка', 'десерт', 'кафе', 'нощувка', 'вечеря', 'храна'],
    off: ['отстъпка'],
    offerWords: ['безплатно', 'подарък'],
    mood: ['5 звезди', 'положителна', 'положителен', 'ако ви хареса'],
    pressure: ['преди да си тръгнете', 'не забравяйте', 'споменете', 'попитайте за'],
    privacy: ['поверително', 'анонимно'],
    time: ['секунди', 'минути'],
  },
})
