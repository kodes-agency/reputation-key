import { REPLY_DRAFTING_V2_APOLOGIES as APOLOGIES } from './domain/reply-drafting-v2'
import { createHash } from 'node:crypto'
import { canonicalizeRfc8785 } from './canonical-json'
import EXAMPLES from './reply-drafting-v2-examples.json'
import BULGARIAN from './reply-drafting-v2-examples-bg.json'
import { REPLY_DRAFTING_V2_PROMPT } from './reply-drafting-v2-prompt'
import {
  replyDraftingV2OptionsSchema,
  REPLY_DRAFTING_V2_VERSIONS,
  type ReplyDraftingV2Options,
} from './reply-drafting-v2-schema'
import {
  REPLY_BODY_RULES,
  type ReplyBodyIssueCode,
} from './domain/reply-body-lint-policy'

export const REPLY_DRAFTING_V2_ROUTE_MAX_BYTES = 131_072
/** Upper bound for the appended examples and controlled rewrite instructions, including JSON escaping. */
export const REPLY_DRAFTING_V2_DYNAMIC_PROMPT_BYTES = 16_384
export const REPLY_DRAFTING_V2_EXAMPLES_DIGEST = createHash('sha256')
  .update('repkey-reply-synthetic-examples-v1\0')
  .update(canonicalizeRfc8785({ en: EXAMPLES, bg: BULGARIAN }))
  .digest('hex')

function language(tag: string): keyof typeof APOLOGIES {
  if (tag.startsWith('bg-')) return 'bg'
  return tag.startsWith('es-') ? 'es' : 'en'
}

function at<T>(values: readonly T[], index: number): T {
  const value = values[index % values.length]
  if (value === undefined) throw new TypeError('Synthetic example catalogue is empty')
  return value
}

/** Only server-derived fixed text enters apologyStart. */
export function resolveReplyDraftingV2Options(
  input: Readonly<{
    languageCode: string
    variation: number
    length?: 'standard' | 'short'
    maxWords?: number
  }>,
): ReplyDraftingV2Options {
  return replyDraftingV2OptionsSchema.parse({
    variation: input.variation,
    length: input.maxWords === undefined ? (input.length ?? 'standard') : 'short',
    ...(input.maxWords === undefined ? {} : { maxWords: input.maxWords }),
    opening: (input.variation % 3) + 1,
    apologyStart: at(
      APOLOGIES[language(input.languageCode)],
      Math.floor(input.variation / 3),
    ),
  })
}

export function validReplyDraftingV2Options(
  options: ReplyDraftingV2Options,
  languageCode: string,
): boolean {
  const parsed = replyDraftingV2OptionsSchema.safeParse(options)
  return (
    parsed.success &&
    canonicalizeRfc8785(parsed.data) ===
      canonicalizeRfc8785(resolveReplyDraftingV2Options({ ...parsed.data, languageCode }))
  )
}

type Example = Readonly<{ rating: number; review: string; reply: string }>

export function pickReplyDraftingV2Examples(
  rating: number,
  variation: number,
  languageCode: string,
): readonly Example[] {
  if (!Number.isSafeInteger(variation) || variation < 0)
    throw new TypeError('Invalid variation')
  if (language(languageCode) === 'bg') return pickBulgarian(rating, variation)
  if (rating >= 4)
    return [
      at(EXAMPLES.positive, variation),
      at(EXAMPLES.positive, variation + 2),
      at(EXAMPLES.positive, variation + 4),
    ]
  if (rating === 3)
    return [
      at(EXAMPLES.mixed, variation),
      at(EXAMPLES.mixed, variation + 1),
      at(EXAMPLES.complaint, variation),
    ]
  const special = at([EXAMPLES.serious, EXAMPLES.money, EXAMPLES.unclear], variation)
  return [
    at(EXAMPLES.complaint, variation),
    at(special, variation),
    at(EXAMPLES.complaint, variation + 3),
  ]
}

function pickBulgarian(rating: number, variation: number): readonly Example[] {
  if (rating >= 4)
    return [at(BULGARIAN.positive, variation), at(BULGARIAN.positive, variation + 1)]
  if (rating === 3)
    return [
      at(BULGARIAN.mixed, variation),
      at(BULGARIAN.positive, variation + 2),
      at(BULGARIAN.complaint, variation),
    ]
  return [
    at(BULGARIAN.complaint, variation),
    at(BULGARIAN.serious, variation),
    at(BULGARIAN.complaint, variation + 1),
  ]
}

export function replyDraftingV2DeveloperMessage(
  input: Readonly<{
    rating: number
    languageCode: string
    variation: number
    rewriteIssues?: readonly ReplyBodyIssueCode[]
  }>,
): string {
  const examples = pickReplyDraftingV2Examples(
    input.rating,
    input.variation,
    input.languageCode,
  )
    .map((e) => `Review (${e.rating} stars): "${e.review}"\nReply: "${e.reply}"`)
    .join('\n\n')
  const parts = [
    REPLY_DRAFTING_V2_PROMPT,
    `Examples of the style (other guests and businesses; never copy their wording):\n${examples}`,
  ]
  if (input.rewriteIssues?.length) {
    const descriptions = [...new Set(input.rewriteIssues)].map(
      (code) => REPLY_BODY_RULES[code][1],
    )
    parts.push(
      `A previous draft for this review broke these rules: ${descriptions.join('; ')}. Write a new draft that follows every rule.`,
    )
  }
  const message = parts.join('\n\n')
  if (
    Buffer.byteLength(JSON.stringify(message)) -
      Buffer.byteLength(JSON.stringify(REPLY_DRAFTING_V2_PROMPT)) >
    REPLY_DRAFTING_V2_DYNAMIC_PROMPT_BYTES
  )
    throw new TypeError('Reply developer material exceeds its reserved bound')
  return message
}

export function buildReplyDraftingV2Payload(
  input: Readonly<{
    rating: number
    tone: string
    languageCode: string
    options: ReplyDraftingV2Options
    sentences: readonly Readonly<{ n: number; text: string }>[]
  }>,
): Readonly<Record<string, unknown>> {
  if (!validReplyDraftingV2Options(input.options, input.languageCode))
    throw new TypeError('Invalid drafting options')
  const { length, maxWords, opening, apologyStart } = input.options
  return {
    replyProfileVersion: REPLY_DRAFTING_V2_VERSIONS.profile,
    rating: input.rating,
    tone: input.tone,
    languageCode: input.languageCode,
    length,
    ...(maxWords === undefined ? {} : { maxWords }),
    opening,
    apologyStart,
    sentences: input.sentences.map(({ n, text }) => ({ n, text })),
  }
}

export function replyDynamicDeveloperBytes(profileVersion: string): number {
  return profileVersion === REPLY_DRAFTING_V2_VERSIONS.operation
    ? REPLY_DRAFTING_V2_DYNAMIC_PROMPT_BYTES
    : 0
}
