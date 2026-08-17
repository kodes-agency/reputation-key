import { z } from 'zod/v4'

export const MERCHANT_AI_NOTICE_VERSION = 'merchant-ai-notice-2026-08-15.v1' as const

const capabilitySchema = z
  .object({
    id: z.enum(['review_analysis', 'reply_drafting', 'property_trends']),
    title: z.string().min(1),
    description: z.string().min(1),
  })
  .strict()

const linkSchema = z
  .object({
    label: z.string().min(1),
    target: z.string().min(1),
  })
  .strict()

const sectionSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
    title: z.string().min(1),
    body: z.array(z.string().min(1)).min(1),
    links: z.array(linkSchema),
  })
  .strict()

const retentionRowSchema = z
  .object({
    id: z.enum(['repkey_raw_source', 'repkey_derivatives', 'provider_monitoring']),
    label: z.string().min(1),
    value: z.string().min(1),
  })
  .strict()

const noticePayloadSchema = z
  .object({
    title: z.string().min(1),
    summary: z.string().min(1),
    sections: z.array(sectionSchema).min(1),
    capabilities: z.tuple([capabilitySchema, capabilitySchema, capabilitySchema]),
    retentionAndRevocation: z.tuple([
      retentionRowSchema,
      retentionRowSchema,
      retentionRowSchema,
    ]),
    risks: z.array(z.string().min(1)).min(1),
    ctaTemplate: z.literal('Enable all three AI features for {propertyName}'),
    requiresStepUp: z.literal(true),
    processingRegion: z.literal('global'),
  })
  .strict()

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends ReadonlyArray<infer Item>
    ? ReadonlyArray<DeepReadonly<Item>>
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T

export type MerchantAiNoticePayload = DeepReadonly<z.infer<typeof noticePayloadSchema>>

export const MERCHANT_AI_NOTICE_PAYLOAD: MerchantAiNoticePayload = Object.freeze({
  title: 'Merchant AI data-use notice',
  summary:
    'Choose which AI-assisted features RepKey may run for this property after reviewing how Google review data is minimized, retained, and sent to OpenAI.',
  sections: Object.freeze([
    Object.freeze({
      id: 'data_and_features',
      title: 'Data and selected features',
      body: Object.freeze([
        'RepKey may use the Google review body, star rating, review time, evaluated language, and property context needed for the selected feature. Reviewer names, profile photos, Google identifiers, exact provider resource names, and raw organization, property, user, and review identifiers are excluded from the provider request.',
        'Before provider processing, RepKey applies automated minimization and redaction. Unstructured personal details can still be missed. A rotating pseudonymous safety identifier contains no raw actor, organization, property, or review identifier.',
        'Supported analysis groups are und, en-Latn, es-Latn, fr-Latn, de-Latn, pt-Latn, it-Latn, nl-Latn, pl-Latn, tr-Latn, uk-Cyrl, ru-Cyrl, ar-Arab, he-Hebr, hi-Deva, bn-Beng, ta-Taml, th-Thai, vi-Latn, id-Latn, zh-Hans, zh-Hant, ja-Jpan, and ko-Kore. Explicit languages outside this catalogue are skipped before provider work.',
      ]),
      links: Object.freeze([
        Object.freeze({ label: 'RepKey privacy notice', target: '/privacy' }),
        Object.freeze({ label: 'Merchant AI controls', target: '/settings/ai' }),
      ]),
    }),
    Object.freeze({
      id: 'provider_posture',
      title: 'OpenAI processing posture',
      body: Object.freeze([
        "RepKey sends minimized and redacted inputs to OpenAI's global API. RepKey requests store:false, no tools, no background execution, and volatile in-memory prompt caching that is generally active for 5–10 minutes of inactivity and at most one hour.",
        "API data is not used to train OpenAI models unless RepKey's OpenAI organization explicitly opts in. Ordinary abuse-monitoring retention is generally up to 30 days, while documented legal or safety exceptions may retain data longer.",
        'There is no guaranteed provider deletion date, no US-only processing promise, no zero-data-retention promise, and no per-request deletion endpoint for this integration.',
      ]),
      links: Object.freeze([
        Object.freeze({
          label: 'OpenAI API data controls',
          target: 'https://platform.openai.com/docs/guides/your-data',
        }),
        Object.freeze({
          label: 'OpenAI subprocessors',
          target: 'https://openai.com/policies/sub-processor-list/',
        }),
      ]),
    }),
    Object.freeze({
      id: 'limits_and_retention',
      title: 'Limits, retention, and revocation',
      body: Object.freeze([
        'Review analysis and reply suggestions accept at most 16 KiB of source and use a 70-second outer attempt deadline. Property trends accept at most 64 KiB and use a 100-second outer attempt deadline. Oversized or unsupported input is skipped rather than truncated into a different meaning.',
        'RepKey keeps raw review source for 30 days and de-identified insights for 24 months under the applicable source and lifecycle controls.',
        'Turning a capability off immediately denies new work, fences in-flight results, hides its prior outputs, and purges unpublished AI-assisted reply drafts. Erasure immediately denies access and purges persisted local AI content; an already-authorized in-memory attempt is discarded by its outer deadline.',
      ]),
      links: Object.freeze([
        Object.freeze({ label: 'Privacy contact', target: '/privacy#contact' }),
      ]),
    }),
    Object.freeze({
      id: 'human_control_and_risk',
      title: 'Human control and AI limitations',
      body: Object.freeze([
        'AI output can be inaccurate. Review analysis and trend summaries are decision support, not facts or professional advice.',
        'Private-beta reply AI selects one fixed application-owned localized template rather than authoring response prose. Suggestions remain editable and are never published without the existing separate human submit, approve, and publish workflow.',
      ]),
      links: Object.freeze([]),
    }),
  ]),
  capabilities: Object.freeze([
    Object.freeze({
      id: 'review_analysis',
      title: 'Review analysis',
      description: 'Analyze new and materially updated eligible Google reviews.',
    }),
    Object.freeze({
      id: 'reply_drafting',
      title: 'Reply drafting',
      description: 'Select an editable localized reply suggestion when a manager asks.',
    }),
    Object.freeze({
      id: 'property_trends',
      title: 'Property trends',
      description: 'Create daily summaries from stored de-identified review analysis.',
    }),
  ]),
  retentionAndRevocation: Object.freeze([
    Object.freeze({
      id: 'repkey_raw_source',
      label: 'RepKey raw review source',
      value: '30 days',
    }),
    Object.freeze({
      id: 'repkey_derivatives',
      label: 'RepKey de-identified insights',
      value: '24 months',
    }),
    Object.freeze({
      id: 'provider_monitoring',
      label: 'OpenAI abuse monitoring',
      value:
        'Generally up to 30 days; documented legal or safety exceptions may be longer',
    }),
  ]),
  risks: Object.freeze([
    'Automated redaction can miss unstructured personal details.',
    'AI analysis and suggestions can be inaccurate.',
    'Provider retention has no guaranteed per-request deletion date.',
  ]),
  ctaTemplate: 'Enable all three AI features for {propertyName}',
  requiresStepUp: true,
  processingRegion: 'global',
})
noticePayloadSchema.parse(MERCHANT_AI_NOTICE_PAYLOAD)

function assertUnicodeScalarString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError('RFC 8785 strings must contain only Unicode scalar values')
      }
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError('RFC 8785 strings must contain only Unicode scalar values')
    }
  }
}

function serializeCanonical(value: unknown, seen: Set<object>): string {
  if (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return JSON.stringify(value)
  }
  if (typeof value === 'string') {
    assertUnicodeScalarString(value)
    return JSON.stringify(value)
  }
  if (typeof value !== 'object') throw new TypeError('RFC 8785 input is not JSON')
  if (seen.has(value)) throw new TypeError('RFC 8785 input contains a cycle')
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new TypeError('RFC 8785 arrays must have the exact Array prototype')
      }
      if (Object.getOwnPropertySymbols(value).length !== 0) {
        throw new TypeError('RFC 8785 arrays cannot contain symbol properties')
      }
      const descriptors = Object.getOwnPropertyDescriptors(value)
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
      if (
        lengthDescriptor === undefined ||
        typeof lengthDescriptor.value !== 'number' ||
        !Number.isSafeInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 0 ||
        Object.keys(descriptors).length !== lengthDescriptor.value + 1
      ) {
        throw new TypeError('RFC 8785 arrays must be dense and unextended')
      }
      const length = lengthDescriptor.value
      const members = new Array<string>(length)
      for (let index = 0; index < length; index += 1) {
        const key = String(index)
        const descriptor = descriptors[key]
        if (
          descriptor === undefined ||
          !descriptor.enumerable ||
          !('value' in descriptor) ||
          descriptor.get !== undefined ||
          descriptor.set !== undefined ||
          descriptor.value === undefined
        ) {
          throw new TypeError('RFC 8785 arrays contain an unsafe member')
        }
        members[index] = serializeCanonical(descriptor.value, seen)
      }
      return `[${members.join(',')}]`
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('RFC 8785 objects must be plain objects')
    }
    if (Object.getOwnPropertySymbols(value).length !== 0) {
      throw new TypeError('RFC 8785 objects cannot contain symbol properties')
    }
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const keys = Object.keys(descriptors).sort()
    const members: string[] = new Array(keys.length)
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!
      assertUnicodeScalarString(key)
      const descriptor = descriptors[key]!
      if (
        !descriptor.enumerable ||
        !('value' in descriptor) ||
        descriptor.get !== undefined ||
        descriptor.set !== undefined ||
        descriptor.value === undefined
      ) {
        throw new TypeError(`RFC 8785 object contains an unsafe property: ${key}`)
      }
      members[index] =
        `${JSON.stringify(key)}:${serializeCanonical(descriptor.value, seen)}`
    }
    return `{${members.join(',')}}`
  } finally {
    seen.delete(value)
  }
}

export function canonicalizeRfc8785(value: unknown): string {
  return serializeCanonical(value, new Set())
}

export const MERCHANT_AI_NOTICE_DIGEST =
  '4ae20219b3ba1ae575ccd567ec88f20201c0c47289606c614ac0bead2c3edc6b' as const
function isLowercaseSha256(value: string): boolean {
  if (value.length !== 64) return false
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index)
    const isDigit = codePoint >= 48 && codePoint <= 57
    const isLowercaseHexLetter = codePoint >= 97 && codePoint <= 102
    if (!isDigit && !isLowercaseHexLetter) return false
  }
  return true
}

const catalogueSelectorSchema = z
  .object({
    version: z.literal(MERCHANT_AI_NOTICE_VERSION),
    digest: z.string().refine(isLowercaseSha256, 'Expected a lowercase SHA-256 digest'),
  })
  .strict()

export type MerchantAiNoticeCatalogueEntry = Readonly<{
  version: typeof MERCHANT_AI_NOTICE_VERSION
  digest: string
  payload: MerchantAiNoticePayload
}>

export function parseMerchantAiNoticeCatalogueEntry(
  value: unknown,
): MerchantAiNoticeCatalogueEntry {
  const selector = catalogueSelectorSchema.parse(value)
  if (selector.digest !== MERCHANT_AI_NOTICE_DIGEST) {
    throw new TypeError(
      'Merchant AI notice digest does not match the immutable catalogue',
    )
  }
  return Object.freeze({
    version: MERCHANT_AI_NOTICE_VERSION,
    digest: MERCHANT_AI_NOTICE_DIGEST,
    payload: MERCHANT_AI_NOTICE_PAYLOAD,
  })
}

export const CURRENT_MERCHANT_AI_NOTICE = parseMerchantAiNoticeCatalogueEntry({
  version: MERCHANT_AI_NOTICE_VERSION,
  digest: MERCHANT_AI_NOTICE_DIGEST,
})
