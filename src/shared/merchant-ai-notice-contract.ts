import { z } from 'zod/v4'
export { canonicalizeRfc8785 } from './canonical-json'

// Changelog — every entry is a new version; the newest is first.
//
// merchant-ai-notice-2026-10-17.v1 — the call to action names no Property
// (owner decision, 2026-10-17):
//   - The call to action reads "Enable AI features" however many Properties the
//     ceremony covers. Naming every one made a twenty-Property import's button
//     one line too long for the page. The acknowledgement still names every
//     Property the consent covers: one in its sentence, several as a list
//     under it.
//   - Nothing else changed. The data use, capabilities, retention, risks and
//     the evidence (actor, notice version, digest, ceremony id) are those of
//     2026-09-15, so consent recorded under 2026-09-15 stays in force and
//     nobody re-consents (`MERCHANT_AI_NOTICES_IN_FORCE`). The contract test
//     recomputes the 2026-09-15 digest from this payload with only the old
//     call to action put back.
//
// merchant-ai-notice-2026-09-15.v1 — the consent ceremony (decisions 3 and 4 in
// docs/plan/property-setup-exploration.md §6):
//   - One ceremony may authorize AI for several Properties at once, such as an
//     import batch. The call to action named every Property it covered
//     (`{propertyNames}`, until 2026-10-17). Enablement and evidence stay per
//     Property; the rows one ceremony writes share its ceremony id.
//   - The password step-up is removed from AI consent everywhere, deliberately,
//     as a change to consent assurance rather than an oversight. Consent is now
//     the notice rendered at this version and digest, an explicit acknowledgement
//     of it by the manager who grants it (an AccountAdmin for a multi-Property
//     ceremony), and the evidence row that records the actor, notice version,
//     digest, and ceremony id. `requiresStepUp` is false; the step-up port stays
//     in the use case as a reserved hook for a future proof.
//
// merchant-ai-notice-2026-09-09.v1 — Review Analysis persists controlled
// aspect/polarity/intensity metadata and one optional generic issue label.
//
// Historical consent stays valid at its own version: the enablement and evidence
// CHECKs keep every known (version, digest) pair
// (merchant-ai-authorization.schema.ts), and a head granted under an earlier
// version is re-granted, not rewritten. Whether it still admits AI work is
// `isMerchantAiNoticeInForce`.
export const MERCHANT_AI_NOTICE_VERSION = 'merchant-ai-notice-2026-10-17.v1' as const

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
    ctaTemplate: z.literal('Enable AI features'),
    requiresStepUp: z.literal(false),
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
    'Choose which AI-assisted features RepKey may run for each selected property after reviewing how Google review data is minimized, retained, and sent to OpenAI.',
  sections: Object.freeze([
    Object.freeze({
      id: 'data_and_features',
      title: 'Data and selected features',
      body: Object.freeze([
        'RepKey may use the Google review body, star rating, review time, evaluated language, and property context needed for the selected feature. Reviewer names, profile photos, Google identifiers, exact provider resource names, and raw organization, property, user, and review identifiers are excluded from the provider request.',
        'Before provider processing, RepKey applies automated minimization and redaction. Unstructured personal details can still be missed. A rotating pseudonymous safety identifier contains no raw actor, organization, property, or review identifier.',
        'Supported analysis groups are und, en-Latn, es-Latn, fr-Latn, de-Latn, pt-Latn, it-Latn, nl-Latn, pl-Latn, tr-Latn, uk-Cyrl, ru-Cyrl, ar-Arab, he-Hebr, hi-Deva, bn-Beng, ta-Taml, th-Thai, vi-Latn, id-Latn, zh-Hans, zh-Hant, ja-Jpan, ko-Kore, and bg-Cyrl. Explicit languages outside this catalogue are skipped before provider work.',
        'Review analysis records which aspects a review mentions and how positively or negatively, plus an optional short generic issue label that is a lowercase category phrase and never reproduces review text or names a person.',
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
        "RepKey sends minimized and redacted inputs to OpenAI's global API. RepKey requests store:false, no tools, no background execution, and 24-hour extended prompt caching: the pinned model does not support volatile in-memory caching, so cached prompt prefixes may persist with the provider for up to 24 hours.",
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
        "A reply suggestion is drafted by the AI provider from the review text and the Property's public display name, grounded in exact excerpts of the review and verified for language before it is shown; when the provider cannot produce a valid draft, a fixed application-owned localized starting point is offered instead. Suggestions remain editable and are never published without the existing separate human submit, approve, and publish workflow.",
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
      description:
        'Draft an editable, grounded reply suggestion from the review when a manager asks.',
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
  ctaTemplate: 'Enable AI features',
  requiresStepUp: false,
  processingRegion: 'global',
})
noticePayloadSchema.parse(MERCHANT_AI_NOTICE_PAYLOAD)

export const MERCHANT_AI_NOTICE_DIGEST =
  '2bcd2be15cbb81f324f9a9390ad00baff3ffbb25a6c0db8bff71fbb2b1b0975e' as const

/** The notice a consent was recorded under, by version and digest. */
export type MerchantAiNoticeReference = Readonly<{
  noticeVersion: string
  noticeDigest: string
}>

/**
 * The notices whose consent is in force: the served one, then every earlier
 * notice whose data use the served one repeats word for word, so a Property
 * consented under it keeps AI running and nobody re-consents. Only new consent
 * is recorded under the served notice. A version that changes what a merchant
 * agrees to is never listed: consent under the versions before it lapses, and
 * every enabled Property re-consents (2026-09-09, 2026-09-15).
 */
export const MERCHANT_AI_NOTICES_IN_FORCE: ReadonlyArray<MerchantAiNoticeReference> =
  Object.freeze([
    Object.freeze({
      noticeVersion: MERCHANT_AI_NOTICE_VERSION,
      noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
    }),
    // Differs only in its call to action, which named every Property.
    Object.freeze({
      noticeVersion: 'merchant-ai-notice-2026-09-15.v1',
      noticeDigest: '6c98ae3bb57b5b142afed1749a1b9f59be8d6ca7edaca3250e39055897289a9c',
    }),
  ])

/**
 * Whether consent recorded under `notice` is in force: its version, with its own
 * digest, is listed in `inForce` (by default the notices this build serves).
 */
export function isMerchantAiNoticeInForce(
  notice: MerchantAiNoticeReference,
  inForce: ReadonlyArray<MerchantAiNoticeReference> = MERCHANT_AI_NOTICES_IN_FORCE,
): boolean {
  return inForce.some(
    (listed) =>
      listed.noticeVersion === notice.noticeVersion &&
      listed.noticeDigest === notice.noticeDigest,
  )
}

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
