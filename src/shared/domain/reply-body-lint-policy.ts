/** Fixed descriptions only: findings and rewrite instructions never carry matched text. */
export const REPLY_BODY_RULES = Object.freeze({
  empty_body: ['hard', 'Write a nonempty reply body'],
  digits: ['hard', 'Spell numbers out'],
  symbols: ['hard', 'Use plain prose without symbols'],
  emoji: ['hard', 'Do not put emoji in the body'],
  avoidance: ['hard', 'Do not repeat any avoidance term'],
  damaging_words: ['hard', 'Refer to sensitive problems only in general terms'],
  singular_voice: ['hard', 'Write as we, never as I'],
  invitation: ['hard', 'Leave contact and return invitations to the local frame'],
  greeting: ['hard', 'Leave greetings to the local frame'],
  sign_off: ['hard', 'Leave sign-offs to the local frame'],
  complaint_exclamation: ['hard', 'Do not use exclamation marks on low ratings'],
  gendered_guest: ['hard', 'Do not describe the guest with a gendered adjective'],
  invented_name: ['hard', 'Use only names present in the review'],
  serious_praise: ['hard', 'Do not mention praise in a serious case'],
  bulgarian_calque: ['hard', 'Use natural Bulgarian without English calques'],
  bulgarian_unwell: ['hard', 'Refer to how the guest felt only in general terms'],
  multiple_apologies: ['hard', 'Apologize at most once'],
  max_words: ['hard', 'Stay within the requested word cap'],
  sentence_reference: ['hard', 'Select only sentence numbers present in the source'],
  prohibited_content: [
    'hard',
    'Promise only to check what happened. Do not offer compensation or admit fault, do not say how things should have been, and talk to the guest about what happened, not about the problem as a topic',
  ],
  private_data: ['hard', 'Do not include private or structured data'],
  stock_phrase: ['soft', 'Use fresh everyday wording'],
  length_band: ['soft', 'Follow the suggested length band'],
  paragraphs: ['soft', 'Use one paragraph'],
  informal_spanish: ['soft', 'Use formal usted in Spanish'],
  lowercase_bulgarian: ['soft', 'Capitalize polite Bulgarian pronouns'],
  repeated_exclamation: ['soft', 'Use at most one exclamation mark'],
  praise_apology: ['soft', 'Avoid an apology in a praise reply'],
} as const)

export type ReplyBodyIssueCode = keyof typeof REPLY_BODY_RULES
export type ReplyBodyFinding = Readonly<{
  code: ReplyBodyIssueCode
  severity: 'hard' | 'soft'
}>
