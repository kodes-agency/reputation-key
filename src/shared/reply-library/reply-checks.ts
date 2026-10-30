export type ReplyCheckKind = 'template_body' | 'final_reply'

export type ReplyFindingCode =
  | 'accusation'
  | 'business_name_in_body'
  | 'conditional_apology'
  | 'contact_in_template'
  | 'emoji_in_complaint'
  | 'emoji_in_template'
  | 'emoji_not_allowed'
  | 'fault_or_incident'
  | 'greeting_or_signoff_in_body'
  | 'legacy_placeholder'
  | 'mixed_languages'
  | 'offer_or_solicitation'
  | 'privacy_content'
  | 'rating_only_presumes_text'
  | 'review_incentive'
  | 'staff_name_in_complaint'
  | 'stock_phrases'
  | 'threat'
  | 'too_long'
  | 'too_many_exclamations'
  | 'too_many_words'
  | 'unknown_variable'
  | 'url'

export type Finding = Readonly<{
  code: ReplyFindingCode
  message: string
}>

export type CheckReplyTextInput = Readonly<{
  text: string
  kind: ReplyCheckKind
  rating?: number
  reviewKind?: 'text' | 'rating_only'
  languageGroup: string
  privacyMode: boolean
  emojiAllowed: boolean
}>

const EMOJI =
  /(?![\u00A9\u00AE\u2122](?!\uFE0F))\p{Extended_Pictographic}|\p{Regional_Indicator}|[\uFE0F\u20E3]/gu
const VARIABLE = /\{[^{}]+\}/gu
const ALLOWED_BODY_VARIABLES = new Set(['{staff_name}', '{thing}', '{visit_word}'])

const OFFER = [
  /\b(?:discount|coupon|promo(?:tion)?(?: code)?)\b/iu,
  /\b\d{1,3}\s*%\s*(?:off|discount)\b/iu,
  /\bfree\s+(?:night|meal|service|treatment|stay)\b/iu,
  /\b(?:book now|reserve ahora|reserva ahora|reserve now)\b/iu,
  /\b(?:descuento|cup[oó]n|promoci[oó]n)\b/iu,
]
const THREAT = [
  /\b(?:we(?:'ll| will)?\s+sue|our lawyers?|legal action|defamator|report you|physical harm)\b/iu,
  /\b(?:demandaremos|nuestros abogados|acci[oó]n legal|denunciaremos)\b/iu,
]
const ACCUSATION = [
  /\b(?:fake review|liar|scam|competitor|no record of you|never (?:a|our) (?:customer|guest)|you must have eaten elsewhere|our food is safe)\b/iu,
  /\b(?:reseña falsa|mentiros[oa]|estafa|competidor|no tenemos registro|nunca fue (?:cliente|hu[eé]sped))\b/iu,
]
const TEXT_PRESUMING = [
  /\b(?:kind words|detailed review|your comments|you mentioned|your review|your words|your notes|thank you for sharing|for mentioning|you describe)\b/iu,
  /\b(?:sus amables palabras|su reseña detallada|sus comentarios|mencion[oó]|su reseña|sus palabras|sus notas|gracias por compartir|por mencionar|usted describe)\b/iu,
]
const STOCK = [
  /\bthrilled\b/iu,
  /\byour feedback is important\b/iu,
  /\bwe strive to\b/iu,
  /\bvalued (?:customer|guest)\b/iu,
  /\bmeans the world\b/iu,
  /\btop priority\b/iu,
  /\bwe take great pride\b/iu,
  /\bexceed(?:ing)? (?:your )?expectations\b/iu,
  /\bsu opini[oó]n es importante\b/iu,
  /\bnuestra m[aá]xima prioridad\b/iu,
]
const CONDITIONAL_OR_DEFENSIVE = [
  /\bsorry (?:that |you )?(?:feel|felt)\b/iu,
  /\bif you were offended\b/iu,
  /\bsorry,? but\b/iu,
  /\bas per our policy\b/iu,
  /\byou should have\b/iu,
  /\byou didn['’]t read\b/iu,
  /\bto be fair\b/iu,
  /\bactually\b/iu,
  /\bsi se sinti[oó] ofendid[oa]\b/iu,
  /\bseg[uú]n nuestra pol[ií]tica\b/iu,
]
const FAULT_OR_INCIDENT = [
  /\b(?:our fault|we caused|liable|liability|negligen|injur|illness|sick|poison|allerg|hospital|theft|stolen|discrimin|accessib|incident|accident|damage|capsize|harass)\w*\b/iu,
  /\b(?:nuestra culpa|causamos|responsabilidad|negligen|lesi[oó]n|enferm|intoxica|alerg|hospital|robo|discrimina|accesib|incidente|accidente|daño|acoso)\w*\b/iu,
]
// Privacy mode (health businesses) refuses words that would confirm someone was a
// patient. "visit", "client" and the business's own name ("Smile Dental") stay allowed.
const PRIVACY = [
  /\{staff_name\}|\{first_name\}/u,
  /\b(?:patients?|appointments?|treatments?|procedures?|diagnos\w*)\b/iu,
  /\b(?:pacientes?|citas?|tratamientos?|procedimientos?|diagn[oó]stic\w*)\b/iu,
]
const GREETING = /^\s*(?:dear|hi|hello|hey|hola|estimad[oa])\b/iu
const SIGNOFF =
  /(?:^|\n)\s*(?:(?:warm |kind |best )?regards|sincerely|best wishes|warmly|all the best|atentamente|saludos cordiales|un cordial saludo|un saludo afectuoso)\s*[,!]?\s*$/iu
const EMAIL = /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/iu
const EMAILS = /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/giu
const PHONE = /(?:^|\D)\+?\d[\d ().-]{7,}\d(?:\D|$)/u
const URL = /(?:https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|co|io)\b)/iu
const REVIEW_CHANGE = /\b(?:updat|chang|remov|actuali|cambi|elimin)\w*\b/iu
const REVIEW_SUBJECT = /\b(?:review|rating|resena|calificacion)\b/iu
const REVIEW_BENEFIT =
  /\b(?:refund|discount|compensate|compensation|reembolso|descuento|compensar|compensacion)\b/iu
const LEGACY_PLACEHOLDERS = [
  '[name]',
  '[first name]',
  '(staff name)',
  '(specific dish)',
  'email adress',
]

function finding(code: ReplyFindingCode, message: string): Finding {
  return { code, message }
}

function any(patterns: readonly RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text))
}

function hasReviewIncentive(text: string): boolean {
  const normalized = text
    .normalize('NFKD')
    .replaceAll(/\p{Mark}/gu, '')
    .toLocaleLowerCase()
  // One sentence must hold all three: a change to the review, the review itself and a
  // benefit. "Thank you for your review. We updated our refund policy." offers nothing.
  return normalized
    .split(/[.!?;\n]+/u)
    .some(
      (sentence) =>
        REVIEW_CHANGE.test(sentence) &&
        REVIEW_SUBJECT.test(sentence) &&
        REVIEW_BENEFIT.test(sentence),
    )
}

function hasLegacyPlaceholder(text: string): boolean {
  const normalized = text.toLocaleLowerCase().replaceAll(/\s+/gu, ' ')
  return LEGACY_PLACEHOLDERS.some((placeholder) => normalized.includes(placeholder))
}

function hasStrongMixedLanguages(text: string): boolean {
  const lines = text
    .split(/\n+/u)
    .map((line) => line.trim())
    .filter(Boolean)
  const sentences = lines.flatMap((line, index) => {
    const signerLine =
      index === lines.length - 1 &&
      (/\b(?:team|management|equipo|gerencia)\b/iu.test(line) ||
        (index > 0 && SIGNOFF.test(lines[index - 1]!)))
    if (signerLine || SIGNOFF.test(line)) return []
    return line.split(/(?<=[.!?])\s+/u).filter((sentence) => wordCount(sentence) >= 6)
  })
  let english = false
  let spanish = false
  for (const sentence of sentences) {
    const en = (
      sentence.match(/\b(?:the|and|we|you|your|our|thank|please|with|for)\b/giu) ?? []
    ).length
    const es = (
      sentence.match(
        /\b(?:el|la|los|las|y|nosotros|usted|su|nuestro|gracias|por|con|para)\b/giu,
      ) ?? []
    ).length
    if (en >= 2 && es === 0) english = true
    if (es >= 2 && en === 0) spanish = true
  }
  return english && spanish
}

function wordCount(text: string): number {
  return (text.match(/\p{Letter}[\p{Letter}\p{Mark}'’_-]*/gu) ?? []).length
}

function wordLimit(input: CheckReplyTextInput): number | null {
  if (input.rating === undefined) return null
  if (input.reviewKind === 'rating_only') return 30
  if (input.rating >= 4) return 60
  if (input.rating === 3) return 90
  return 120
}

// fallow-ignore-next-line complexity -- one flat, exhaustive catalogue of independently reported reply policy findings
export function checkReplyText(input: CheckReplyTextInput): Readonly<{
  blocks: Finding[]
  warnings: Finding[]
}> {
  const blocks: Finding[] = []
  const warnings: Finding[] = []
  const { text } = input

  if (new TextEncoder().encode(text).byteLength > 4096) {
    blocks.push(finding('too_long', 'Reply text must be 4,096 UTF-8 bytes or fewer.'))
  }
  // An email address is a contact, not a link: the voice adds one to complaint replies.
  if (URL.test(text.replace(EMAILS, ' '))) {
    blocks.push(finding('url', 'Remove links and web addresses.'))
  }
  if (any(OFFER, text)) {
    blocks.push(
      finding('offer_or_solicitation', 'Remove offers, discounts, and booking prompts.'),
    )
  }
  if (hasReviewIncentive(text)) {
    blocks.push(
      finding('review_incentive', 'Do not offer a benefit for changing a review.'),
    )
  }
  if (any(THREAT, text))
    blocks.push(finding('threat', 'Remove threats and legal intimidation.'))
  if (any(ACCUSATION, text))
    blocks.push(finding('accusation', 'Remove accusations about the reviewer.'))
  if (hasLegacyPlaceholder(text)) {
    blocks.push(finding('legacy_placeholder', 'Replace the leftover legacy placeholder.'))
  }
  const unknown = [...text.matchAll(VARIABLE)]
    .map(([token]) => token)
    .filter((token) => !ALLOWED_BODY_VARIABLES.has(token))
  if (unknown.length > 0) {
    blocks.push(
      finding(
        'unknown_variable',
        `Replace unsupported variables: ${[...new Set(unknown)].join(', ')}.`,
      ),
    )
  }
  if (hasStrongMixedLanguages(text)) {
    blocks.push(finding('mixed_languages', 'Use one language in a reply.'))
  }
  if (input.privacyMode && any(PRIVACY, text)) {
    blocks.push(
      finding(
        'privacy_content',
        'Privacy mode excludes names and health-service details.',
      ),
    )
  }

  const hasEmoji = EMOJI.test(text)
  EMOJI.lastIndex = 0
  if (input.kind === 'template_body') {
    if (input.reviewKind === 'rating_only' && any(TEXT_PRESUMING, text)) {
      blocks.push(
        finding(
          'rating_only_presumes_text',
          'Rating-only templates must not refer to written feedback.',
        ),
      )
    }
    if (GREETING.test(text) || SIGNOFF.test(text)) {
      blocks.push(
        finding(
          'greeting_or_signoff_in_body',
          'Template bodies must not contain a greeting or sign-off.',
        ),
      )
    }
    if (hasEmoji)
      blocks.push(finding('emoji_in_template', 'Template bodies must not contain emoji.'))
    if (EMAIL.test(text) || PHONE.test(text)) {
      blocks.push(
        finding(
          'contact_in_template',
          'Template bodies must not contain an email address or phone number.',
        ),
      )
    }
  }

  const stockCount = STOCK.filter((pattern) => pattern.test(text)).length
  if (stockCount >= 2)
    warnings.push(
      finding('stock_phrases', 'Several stock phrases make the reply sound generic.'),
    )
  if (any(CONDITIONAL_OR_DEFENSIVE, text)) {
    warnings.push(
      finding('conditional_apology', 'Review conditional or defensive wording.'),
    )
  }
  if (any(FAULT_OR_INCIDENT, text)) {
    warnings.push(
      finding('fault_or_incident', 'A manager should review fault or incident wording.'),
    )
  }
  if ((input.rating ?? 5) <= 3 && text.includes('{staff_name}')) {
    warnings.push(
      finding('staff_name_in_complaint', 'Avoid naming staff in a complaint reply.'),
    )
  }
  if ((input.rating ?? 5) <= 3 && hasEmoji) {
    warnings.push(
      finding('emoji_in_complaint', 'Emoji can read poorly in complaint replies.'),
    )
  } else if (input.kind === 'final_reply' && hasEmoji && !input.emojiAllowed) {
    warnings.push(finding('emoji_not_allowed', 'The reply voice has emoji turned off.'))
  }
  const limit = wordLimit(input)
  if (limit !== null && wordCount(text) > limit) {
    warnings.push(
      finding(
        'too_many_words',
        `This reply is longer than the ${limit}-word guide for its band.`,
      ),
    )
  }
  if ((text.match(/!/gu) ?? []).length > 1) {
    warnings.push(
      finding('too_many_exclamations', 'Use no more than one exclamation mark.'),
    )
  }
  if (
    input.kind === 'template_body' &&
    /\b(?:LLC|Inc\.?|Ltd\.?|Corp\.?|Hotel|Restaurant|Salon|Spa)\b/u.test(text)
  ) {
    warnings.push(
      finding(
        'business_name_in_body',
        'Keep the full business name in the reply voice, not the body.',
      ),
    )
  }

  return { blocks, warnings }
}
