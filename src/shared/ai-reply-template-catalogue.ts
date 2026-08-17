import { createHash } from 'node:crypto'
import { z } from 'zod/v4'
import rawCatalogue from './ai-reply-template-catalogue-v1.json'
import {
  REPLY_TEMPLATE_LANGUAGE_GROUPS,
  type ReplyTemplateLanguageGroup,
} from './ai-review-language-catalogue'
import {
  AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
  AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
  scanAiReplyOutput,
} from './ai-reply-output-leakage'
import { AI_STRUCTURED_MARKER_DETECTORS_DIGEST } from './ai-structured-marker-detectors'
import {
  createCld3ReplyLanguageDetector,
  verifyReplyTemplateCatalogueEntry,
} from './ai-reply-language-verifier'
import { canonicalizeRfc8785 } from './merchant-ai-notice-contract'

export const AI_REPLY_TEMPLATE_CATALOGUE_VERSION =
  'gbp-reply-template-catalogue-v1' as const

export const REPLY_TONES = Object.freeze(['professional', 'friendly', 'casual'] as const)

export const REPLY_TEMPLATE_IDS = Object.freeze([
  'appreciation_positive',
  'appreciation_neutral',
  'recovery_service',
  'acknowledge_concern',
] as const)

export type ReplyTone = (typeof REPLY_TONES)[number]
export type ReplyTemplateId = (typeof REPLY_TEMPLATE_IDS)[number]

export type AiReplyTemplateEntry = Readonly<{
  templateGroup: ReplyTemplateLanguageGroup
  tone: ReplyTone
  templateId: ReplyTemplateId
  text: string
}>

export type AiReplyTemplateCatalogue = Readonly<{
  version: typeof AI_REPLY_TEMPLATE_CATALOGUE_VERSION
  entries: readonly AiReplyTemplateEntry[]
}>

const templateEntrySchema = z
  .object({
    templateGroup: z.enum(REPLY_TEMPLATE_LANGUAGE_GROUPS),
    tone: z.enum(REPLY_TONES),
    templateId: z.enum(REPLY_TEMPLATE_IDS),
    text: z.string(),
  })
  .strict()
const templateLookupSchema = z
  .object({
    templateGroup: z.enum(REPLY_TEMPLATE_LANGUAGE_GROUPS),
    tone: z.enum(REPLY_TONES),
    templateId: z.enum(REPLY_TEMPLATE_IDS),
  })
  .strict()

const templateCatalogueSchema = z
  .object({
    version: z.literal(AI_REPLY_TEMPLATE_CATALOGUE_VERSION),
    entries: z.array(templateEntrySchema).length(276),
  })
  .strict()

const TEMPLATE_VALIDATION_COUNTRY = 'US' as const

function assertTemplateText(text: string): void {
  const byteLength = Buffer.byteLength(text, 'utf8')
  if (byteLength < 1 || byteLength > 16_384) {
    throw new TypeError('reply template text must contain 1..16384 UTF-8 bytes')
  }
  if (text.normalize('NFKC') !== text) {
    throw new TypeError('reply template text must be NFKC-stable')
  }

  let scalars = 0
  let letters = 0
  for (const scalar of text) {
    scalars += 1
    if (/\p{L}/u.test(scalar)) letters += 1
    if (/[\p{N}\p{S}\p{Cc}\p{Cf}\p{Cs}\p{Co}]/u.test(scalar)) {
      throw new TypeError('reply template contains a forbidden scalar')
    }
    if (/\p{Z}/u.test(scalar) && scalar !== ' ') {
      throw new TypeError('reply template contains a forbidden separator')
    }
  }

  if (scalars > 4_096) {
    throw new TypeError('reply template text exceeds 4096 Unicode scalars')
  }
  if (letters < 24) {
    throw new TypeError('reply template text must contain at least 24 Unicode letters')
  }
  const leakageResult = scanAiReplyOutput({
    text,
    countryCode: TEMPLATE_VALIDATION_COUNTRY,
    expectedProfileVersion: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
    expectedProfileDigest: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
    expectedDetectorProfileDigest: AI_STRUCTURED_MARKER_DETECTORS_DIGEST,
  })
  if (leakageResult !== 'safe') {
    throw new TypeError(
      `reply template failed output leakage validation: ${leakageResult}`,
    )
  }
}

function tupleKey(
  templateGroup: ReplyTemplateLanguageGroup,
  tone: ReplyTone,
  templateId: ReplyTemplateId,
): string {
  return `${templateGroup}\0${tone}\0${templateId}`
}

function freezeCatalogue(
  catalogue: z.infer<typeof templateCatalogueSchema>,
): AiReplyTemplateCatalogue {
  const entries = catalogue.entries.map((entry) => Object.freeze({ ...entry }))
  return Object.freeze({ version: catalogue.version, entries: Object.freeze(entries) })
}

export function parseAiReplyTemplateCatalogue(value: unknown): AiReplyTemplateCatalogue {
  const parsed = templateCatalogueSchema.parse(value)
  let index = 0
  const seen = new Set<string>()

  for (const templateGroup of REPLY_TEMPLATE_LANGUAGE_GROUPS) {
    for (const tone of REPLY_TONES) {
      for (const templateId of REPLY_TEMPLATE_IDS) {
        const entry = parsed.entries[index]
        if (
          entry?.templateGroup !== templateGroup ||
          entry.tone !== tone ||
          entry.templateId !== templateId
        ) {
          throw new TypeError(
            `reply template tuple ${index} is missing, duplicated, or out of canonical order`,
          )
        }
        const key = tupleKey(entry.templateGroup, entry.tone, entry.templateId)
        if (seen.has(key)) {
          throw new TypeError(`duplicate reply template tuple at index ${index}`)
        }
        seen.add(key)
        assertTemplateText(entry.text)
        index += 1
      }
    }
  }

  if (index !== parsed.entries.length || seen.size !== 276) {
    throw new TypeError('reply template catalogue must contain exactly 276 unique tuples')
  }
  return freezeCatalogue(parsed)
}

function digestCatalogue(value: AiReplyTemplateCatalogue): string {
  return createHash('sha256')
    .update('repkey-reply-template-catalogue-v1\0', 'utf8')
    .update(canonicalizeRfc8785(value), 'utf8')
    .digest('hex')
}

const catalogue = parseAiReplyTemplateCatalogue(rawCatalogue)

export const AI_REPLY_TEMPLATE_CATALOGUE_DIGEST = digestCatalogue(catalogue)

export type AiReplyTemplateCatalogueBuildValidation = Readonly<{
  version: typeof AI_REPLY_TEMPLATE_CATALOGUE_VERSION
  digest: string
  entryCount: 276
}>

export async function validateAiReplyTemplateCatalogueBuild(
  value: unknown,
): Promise<AiReplyTemplateCatalogueBuildValidation> {
  const parsed = parseAiReplyTemplateCatalogue(value)
  const detector = await createCld3ReplyLanguageDetector()
  const failedTuples: string[] = []
  try {
    for (const entry of parsed.entries) {
      const result = verifyReplyTemplateCatalogueEntry(
        entry.text,
        entry.templateGroup,
        detector,
      )
      if (result.status !== 'valid') {
        const detection = detector.detect(entry.text)
        failedTuples.push(
          `${entry.templateGroup}/${entry.tone}/${entry.templateId}` +
            `(${detection.language},${detection.probability},${detection.reliable})`,
        )
      }
    }
  } finally {
    detector.dispose()
  }
  if (failedTuples.length > 0) {
    throw new TypeError(
      `reply templates failed language validation: ${failedTuples.join(', ')}`,
    )
  }
  return Object.freeze({
    version: parsed.version,
    digest: digestCatalogue(parsed),
    entryCount: 276 as const,
  })
}

const TEMPLATE_TEXT_BY_TUPLE: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    catalogue.entries.map((entry) => [
      tupleKey(entry.templateGroup, entry.tone, entry.templateId),
      entry.text,
    ]),
  ),
)

export function resolveAiReplyTemplate(
  input: Readonly<{
    templateGroup: ReplyTemplateLanguageGroup
    tone: ReplyTone
    templateId: ReplyTemplateId
  }>,
): string {
  const parsed = templateLookupSchema.parse(input)
  const key = tupleKey(parsed.templateGroup, parsed.tone, parsed.templateId)
  const text = TEMPLATE_TEXT_BY_TUPLE[key]
  if (text === undefined) throw new TypeError('unknown reply template tuple')
  return text
}
