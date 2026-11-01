import {
  REPLY_BODY_RULES,
  type ReplyBodyFinding,
  type ReplyBodyIssueCode,
} from './domain/reply-body-lint-policy'
export type {
  ReplyBodyFinding,
  ReplyBodyIssueCode,
} from './domain/reply-body-lint-policy'
import { createHash } from 'node:crypto'
import { canonicalizeRfc8785 } from './canonical-json'

// Code checks for an AI reply body (Phase 0). `hard` problems trigger the one automatic retry;
// `soft` ones are only counted. Matching ignores case and accents; short terms match whole words,
// longer ones match at the start of a word, so stems like "cucarach" catch every form.

export type Language = 'en' | 'es' | 'bg'

export type LintInput = Readonly<{
  body: string
  reviewText?: string
  language: Language
  rating: number
  modelCase: string | null
  avoidTerms: readonly string[]
  reviewWordCount: number
  maxWords?: number
}>

const DAMAGING: Readonly<Record<Language, readonly string[]>> = {
  en: [
    'serious reaction',
    'severe reaction',
    'cockroach',
    'roach',
    'bedbug',
    'bed bug',
    'bed-bug',
    'rat',
    'rats',
    'mouse',
    'mice',
    'rodent',
    'insect',
    'mould',
    'mold',
    'poisoning',
    'poisoned',
    'vomit',
    'diarrh',
    'sick',
    'unwell',
    'ill$',
    'illness',
    'medical',
    'doctor',
    'ambulance',
    'emergency room',
    'injur',
    'burned',
    'burnt',
    'blood',
    'bleed',
    'hospital$',
    'allerg',
    'infect',
    'antibiot',
    'stolen',
    'steal',
    'theft',
    'thief',
    'robbed',
    'racis',
    'discriminat',
    'homophob',
    'sexis',
    'harass',
    'lawyer',
    'attorney',
    'solicitor',
    'lawsuit',
    'sue',
    'court$',
    'courts$',
    'legal action',
    'police',
    'inspector',
    'scam',
    'fraud',
  ],
  es: [
    'cucarach',
    'chinche',
    'rata',
    'ratas',
    'raton',
    'ratones',
    'roedor',
    'insecto',
    'moho',
    'intoxicac',
    'envenen',
    'vomit',
    'diarrea',
    'enferm',
    'malestar',
    'medic',
    'ambulancia',
    'urgencias',
    'lesion',
    'herid',
    'quemadur',
    'hospital$',
    'alergi',
    'infecc',
    'antibiot',
    'robo',
    'robad',
    'ladron',
    'racis',
    'discrimin',
    'homofob',
    'acoso',
    'abogad',
    'demanda',
    'denuncia',
    'policia',
    'inspector',
    'estafa',
    'fraude',
  ],
  bg: [
    'хлебарк',
    'дървениц',
    'плъх',
    'мишк',
    'гризач',
    'насеком',
    'мухъл',
    'плесен',
    'отравян',
    'отрови',
    'повръщ',
    'диария',
    'неразполож',
    'лекар',
    'медицинск',
    'линейк',
    'спешн',
    'болен',
    'болна',
    'болни',
    'наранява',
    'нараняв',
    'изгар',
    'изгор',
    'болниц',
    'алерг',
    'възпал',
    'инфекц',
    'антибиот',
    'кражб',
    'открадн',
    'крадец',
    'расис',
    'дискрими',
    'тормоз',
    'адвокат',
    'съд',
    'полици',
    'инспекц',
    'измам',
  ],
}

const FIRST_PERSON_SINGULAR: Readonly<Record<Language, readonly string[]>> = {
  en: [],
  es: [
    'yo$',
    'lamento$',
    'siento$',
    'agradezco$',
    'espero$',
    'me alegra$',
    'me alegro$',
    'quisiera$',
    'creo$',
  ],
  bg: [
    'аз$',
    'съжалявам$',
    'благодаря$',
    'радвам се$',
    'надявам се$',
    'искам$',
    'мисля$',
  ],
}

const INVITATIONS: Readonly<Record<Language, readonly string[]>> = {
  en: [
    'contact us',
    'reach out',
    'get in touch',
    'reach us',
    'email us',
    'e-mail us',
    'call us',
    'give us a call',
    'let us know',
    'drop us',
    'message us',
    'speak with you',
    'talk with you',
    'hear more',
    'understand more',
    'learn more',
    'hope to see you',
    'welcome you back',
    'see you again',
    'see you soon',
    'come back',
    'next visit',
    'next stay',
    'next time you',
    'visit us again',
  ],
  es: [
    'contactenos',
    'contacte con',
    'contactar con nosotros',
    'pongase en contacto',
    'ponerse en contacto',
    'escribanos',
    'llamenos',
    'comuniquese',
    'saber mas',
    'conocer mas',
    'esperamos verle',
    'volver a verle',
    'volver a recibirle',
    'proxima visita',
    'proxima vez',
    'nos visite de nuevo',
    'vuelva pronto',
    'esperamos verla',
    'esperamos verlo',
  ],
  bg: [
    'свържете се',
    'пишете ни',
    'обадете се',
    'да научим повече',
    'повече подробности',
    'очакваме ви отново',
    'очакваме да ви',
    'до нови срещи',
    'следващото ви посещение',
    'следващия път',
    'отново при нас',
    'заповядайте отново',
    'да ви посрещнем отново',
  ],
}

const STOCK: Readonly<Record<Language, readonly string[]>> = {
  en: [
    'your words',
    'your review reflects',
    'your comments show',
    'sorry for the frustration',
    'delighted',
    'thrilled',
    'rest assured',
    'we strive',
    'valued guest',
    'feedback is important',
    'thank you for your feedback',
    'thanks for your feedback',
    'fell short',
    'falls short',
    'we understand how',
    'we can imagine',
    'for any inconvenience',
    'take this seriously',
    'not acceptable',
    'unacceptable',
    'experience you should have had',
    'the experience you deserve',
    'means the world',
    'kind words',
  ],
  es: [
    'sus palabras',
    'su comentario refleja',
    'su opinión refleja',
    'la frustración que',
    'nos complace',
    'su opinion es muy importante',
    'sus comentarios son muy importantes',
    'agradecemos sus comentarios',
    'lamentamos las molestias',
    'cualquier inconveniente',
    'no es aceptable',
    'inaceptable',
    'nos tomamos muy en serio',
    'entendemos lo frustrante',
    'no estuvo a la altura de sus expectativas',
    'amables palabras',
  ],
  bg: [
    'разбираемо разочаров',
    'сериозен пропуск',
    'по думите ви',
    'думите ви показват',
    'от думите ви',
    'разочарованието',
    'благодарим ви за отзива',
    'вашето мнение е важно',
    'съжаляваме за причиненото неудобство',
    'за причинените неудобства',
    'неприемливо',
    'приемаме сериозно',
    'разбираме колко',
    'не отговаря на очакванията',
    'милите думи',
    'топлите думи',
  ],
}

const PRAISE_WORDS: Readonly<Record<Language, readonly string[]>> = {
  en: ['glad', 'enjoyed', 'pleased', 'happy to hear', 'lovely to hear'],
  es: ['nos alegra', 'disfrut', 'contentos', 'nos complace'],
  bg: ['радваме', 'радва ни', 'доволни', 'харесал', 'харесала', 'харесали'],
}

const APOLOGY: Readonly<Record<Language, RegExp>> = {
  en: /\b(sorry|apologi[sz]e|apologies|regret)/giu,
  es: /(lamentamos|sentimos|nos apena|disculp|perdon)/giu,
  bg: /(съжаляваме|извин|прошка)/giu,
}

const GREETING: Readonly<Record<Language, RegExp>> = {
  en: /^(dear|hi|hello|hey)\b/iu,
  es: /^(hola|estimad[oa]|querid[oa])\b/iu,
  bg: /^(здравейте|здравей|уважаем|скъп)/iu,
}

const SIGN_OFF: Readonly<Record<Language, RegExp>> = {
  en: /(best regards|kind regards|warm regards|sincerely|best wishes|all the best)[\s,.]*$/iu,
  es: /(saludos|atentamente|un abrazo|cordialmente)[\s,.]*$/iu,
  bg: /(поздрави|с уважение)[\s,.]*$/iu,
}

const LENGTH_BANDS: Readonly<Record<string, readonly [number, number]>> = {
  praise: [15, 40],
  praise_with_issue: [15, 40],
  mixed: [15, 45],
  complaint: [20, 45],
  serious: [15, 40],
  money: [15, 40],
  unclear: [5, 25],
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[’`´]/gu, "'")
}

function termPattern(term: string, dictionarySyntax: boolean): RegExp | null {
  // A trailing "$" asks for a whole word ("hospital$" must not match "hospitality").
  const wholeWord = dictionarySyntax && term.endsWith('$')
  const clean = normalize(wholeWord ? term.slice(0, -1) : term).trim()
  if (clean.length < 2) return null
  const escaped = clean.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/\s+/gu, '\\s+')
  // A term the provider supplied is a word, so its stem reaches inflections, not another
  // word: "петна" (stains) must not match "петнадесет" (fifteen).
  const inflection = dictionarySyntax ? '' : '[\\p{L}\\p{N}]{0,4}(?![\\p{L}\\p{N}])'
  const tail = wholeWord || clean.length <= 4 ? '(?![\\p{L}\\p{N}])' : inflection
  // eslint-disable-next-line security/detect-non-literal-regexp -- metacharacters are escaped; only a bounded literal term and Unicode word edges enter the expression
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}${tail}`, 'u')
}

// A reply talks to the guest about what happened, not about the problem as a topic.
const ANALYST: Readonly<Record<Language, readonly string[]>> = {
  en: [
    'the main problem',
    'the main issue',
    'the core problem',
    'the core issue',
    'the key issue',
  ],
  es: ['el principal problema', 'el problema principal'],
  bg: ['основният проблем', 'основния проблем', 'главният проблем', 'главния проблем'],
}
// Lectures the business and admits the complaint at once. Only on ratings of three or less:
// on praise, "you deserve" is a compliment.
const LECTURE: Readonly<Record<Language, readonly string[]>> = {
  en: [
    'you should have',
    "you shouldn't have",
    'you should not have',
    'you deserve',
    'you deserved',
    'every guest',
    'every customer',
  ],
  es: ['deberia haber', 'usted merece', 'merecia', 'todo cliente', 'todos los clientes'],
  bg: ['трябваше да', 'трябвало е', 'всеки гост', 'заслужавате', 'заслужавахте'],
}
// Plays the problem down, unless the guest called it that first.
const CONFUSION: Readonly<Record<Language, readonly string[]>> = {
  en: ['confus', 'misunderstand'],
  es: ['confus', 'malentend'],
  bg: ['объркв', 'объркан', 'недоразумен'],
}

function findTerms(
  body: string,
  terms: readonly string[],
  dictionarySyntax = true,
): string[] {
  const text = normalize(body)
  return terms.filter((term) => termPattern(term, dictionarySyntax)?.test(text) ?? false)
}

function wordCount(text: string): number {
  return text.split(/\s+/u).filter(Boolean).length
}

function englishFirstPerson(body: string): boolean {
  return (
    /(^|[^\p{L}])I(['’](m|ve|d|ll))?(?![\p{L}])/u.test(body) ||
    /\b(me|my|mine|myself)\b/iu.test(body)
  )
}

function analystVoice({ body, language, reviewText }: LintInput): boolean {
  if (findTerms(body, ANALYST[language]).length > 0) return true
  return (
    findTerms(body, CONFUSION[language]).length > 0 &&
    findTerms(reviewText ?? '', CONFUSION[language]).length === 0
  )
}

function lectures({ body, language, rating }: LintInput): boolean {
  return rating <= 3 && findTerms(body, LECTURE[language]).length > 0
}

function lowercasePoliteBulgarian(body: string): boolean {
  return /(^|[^\p{L}])(ви|вие|вас|ваш\p{L}*)(?![\p{L}])/u.test(body)
}

function spanishInformal(body: string): boolean {
  const text = normalize(body)
  return /(?<![\p{L}])(tu|tus|contigo|tuviste|disfrutaste|estuviste|viniste|fuiste|describes|comentas|mencionas|cuentas|puedes|quieres|tienes|estes|hayas|sientas|te sentiste)(?![\p{L}])/u.test(
    text,
  )
}

const CAPITALISED_OK = new Set(['Вие', 'Ви', 'Вас', 'Вам', 'Usted', 'Ud'])

// A capitalised word inside a sentence (a name) must come from the review: the model may not
// invent or respell a person's or a place's name.
function namesNotInReview(body: string, reviewText: string): string[] {
  const review = normalize(reviewText)
  const found = new Set<string>()
  for (const sentence of body.split(/(?<=[.!?;])\s+/u)) {
    const words = sentence.split(/\s+/u).slice(1)
    for (const raw of words) {
      const word = raw.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '').replace(/['’]s$/u, '')
      if (
        !/^\p{Lu}\p{Ll}/u.test(word) ||
        CAPITALISED_OK.has(word) ||
        /^Ваш\p{L}*$/u.test(word)
      )
        continue
      if (!review.replaceAll('-', '').includes(normalize(word).replaceAll('-', '')))
        found.add(word)
    }
  }
  return [...found]
}

// Spanish and Bulgarian adjectives about the guest need a gender the model does not know.
function genderedGuestWord(body: string, language: Language): boolean {
  if (language === 'bg') {
    // eslint-disable-next-line security/detect-unsafe-regex -- one optional word between literal verb and adjective stems; bodies are bounded at 1200 characters
    return /(сте|останахте|бяхте|почувствахте се|чувствате се|чувствахте се)\s+(\p{L}+\s+)?(доволн|недоволн|разочарован|ядосан|притеснен|впечатлен|изненадан|огорчен|обиден|уморен)\p{L}*/iu.test(
      body,
    )
  }
  if (language === 'es') {
    // eslint-disable-next-line security/detect-unsafe-regex -- one optional word between literal verb and adjective stems; bodies are bounded at 1200 characters
    return /(esté|estuviera|estaba|quedara|quedó|haya quedado|se sintiera|se sintió|sentirse|sintiéndose)\s+(\p{L}+\s+)?(satisfech|insatisfech|decepcionad|molest|content|encantad|frustrad|preocupad|sorprendid|atendid|ignorad|desatendid)\p{L}*/iu.test(
      body,
    )
  }
  return false
}

function checks(input: LintInput): readonly (readonly [ReplyBodyIssueCode, boolean])[] {
  const { body, language } = input
  return [
    ['empty_body', !body.trim()],
    ['digits', /\p{N}/u.test(body)],
    ['symbols', /[&+=%@:/#_`]|\p{Sc}/u.test(body)],
    ['emoji', /\p{Extended_Pictographic}/u.test(body)],
    ['avoidance', findTerms(body, input.avoidTerms, false).length > 0],
    ['damaging_words', findTerms(body, DAMAGING[language]).length > 0],
    [
      'singular_voice',
      language === 'en'
        ? englishFirstPerson(body)
        : findTerms(body, FIRST_PERSON_SINGULAR[language]).length > 0,
    ],
    ['invitation', findTerms(body, INVITATIONS[language]).length > 0],
    ['greeting', GREETING[language].test(body)],
    ['sign_off', SIGN_OFF[language].test(body)],
    ['complaint_exclamation', input.rating <= 2 && body.includes('!')],
    ['gendered_guest', genderedGuestWord(body, language)],
    ['invented_name', namesNotInReview(body, input.reviewText ?? '').length > 0],
  ]
}

function styleChecks(
  input: LintInput,
): readonly (readonly [ReplyBodyIssueCode, boolean])[] {
  const { body, language } = input
  const apologies = (body.match(APOLOGY[language]) ?? []).length
  return [
    [
      'serious_praise',
      input.modelCase === 'serious' && findTerms(body, PRAISE_WORDS[language]).length > 0,
    ],
    [
      'bulgarian_calque',
      language === 'bg' &&
        findTerms(body, ['разбираемо разочаров', 'сериозен пропуск']).length > 0,
    ],
    [
      'bulgarian_unwell',
      // eslint-disable-next-line security/detect-unsafe-regex -- a letter stem followed by at most one fixed reflexive word and literal health wording; bounded body
      language === 'bg' && /почувств\p{L}*\s+(се\s+)?(зле|неразположен)/iu.test(body),
    ],
    ['prohibited_content', analystVoice(input) || lectures(input)],
    ['multiple_apologies', apologies > 1],
    ['max_words', input.maxWords !== undefined && wordCount(body) > input.maxWords],
    ['stock_phrase', findTerms(body, STOCK[language]).length > 0],
    ['length_band', outsideLengthBand(input)],
    ['paragraphs', /\n/u.test(body.trim())],
    ['informal_spanish', language === 'es' && spanishInformal(body)],
    ['lowercase_bulgarian', language === 'bg' && lowercasePoliteBulgarian(body)],
    ['repeated_exclamation', (body.match(/!/gu) ?? []).length > 1],
    ['praise_apology', input.modelCase === 'praise' && apologies > 0],
  ]
}

function outsideLengthBand(input: LintInput): boolean {
  const band = LENGTH_BANDS[input.modelCase ?? '']
  if (!band) return false
  const low = input.reviewWordCount <= 8 ? Math.min(band[0], 5) : band[0]
  const words = wordCount(input.body)
  return words < low || words > band[1]
}

export function lintReplyDraftingV2Body(input: LintInput): readonly ReplyBodyFinding[] {
  return [...checks(input), ...styleChecks(input)]
    .filter(([, failed]) => failed)
    .map(([code]) => ({ code, severity: REPLY_BODY_RULES[code][0] }))
}

export function replyBodyFinding(code: ReplyBodyIssueCode): ReplyBodyFinding {
  return { code, severity: REPLY_BODY_RULES[code][0] }
}

export function hasReplyAvoidanceTerm(body: string, terms: readonly string[]): boolean {
  return findTerms(body, terms, false).length > 0
}

export const REPLY_BODY_LINT_VERSION = 'reply-body-lint-v1' as const
// Include the dictionaries AND the matchers. No source/rejected text enters this digest.
export const REPLY_BODY_LINT_DIGEST = createHash('sha256')
  .update('repkey-reply-body-lint-v1\0')
  .update(
    canonicalizeRfc8785({
      version: REPLY_BODY_LINT_VERSION,
      rules: REPLY_BODY_RULES,
      damaging: DAMAGING,
      singular: FIRST_PERSON_SINGULAR,
      invitations: INVITATIONS,
      stock: STOCK,
      analyst: ANALYST,
      confusion: CONFUSION,
      lecture: LECTURE,
      praise: PRAISE_WORDS,
      bands: LENGTH_BANDS,
      apologies: Object.values(APOLOGY).map((p) => p.toString()),
      greetings: Object.values(GREETING).map((p) => p.toString()),
      signOffs: Object.values(SIGN_OFF).map((p) => p.toString()),
      matching: {
        version: 'phase0-final-v1',
        normalization: 'NFD-strip-M-lower-apostrophes',
        terms:
          'Unicode-letter-number-edges;whole-through-four;stem-above;provider-terms-stem-plus-four;dictionary-dollar-forces-whole;avoidance-literals;skip-normalized-under-two',
        namePolicy:
          'capitalized-noninitial-word-normalized-hyphenless-substring-in-source',
        guestAdjectives: 'es-bg-phase0-final',
        politePronouns: 'es-bg-phase0-final',
        unicodeDigits: true,
        maxWords: 'whitespace-words',
      },
    }),
  )
  .digest('hex')
