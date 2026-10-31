import type { MerchantAiCapability } from './domain/merchant-ai-capability'
import { z } from 'zod/v4'
export { canonicalizeRfc8785 } from './canonical-json'

// Changelog — every entry is a new version; the newest is first.
// 2026-11-01: background/body-only drafting v2; materially changes reply_drafting
// alone. Review Analysis and trends retain their epochs (ADR 0074).
//
// merchant-ai-notice-2026-10-30.v1 — the switch-on of review analysis v3
// (the text the owner approved on 2026-10-30, served word for word):
//   - The data use changes, so this is a material change and the notices before it
//     are NOT in force (`MERCHANT_AI_NOTICES_IN_FORCE` lists this one alone): a
//     consent recorded under 2026-10-17 or 2026-09-15 lapses at the deploy, AI work
//     for a Property is refused before it is claimed, and an AccountAdmin confirms
//     it again (Settings, then AI). That re-consent moves the notice and the
//     deployment profile, which bumps the review analysis epoch and analyses the
//     history again (ADR 0031).
//   - Names Anthropic beside OpenAI (used through an account held by Mission Morph
//     LLC), lists what review analysis v3 keeps, says staff and guest names reach the
//     provider as written, and adds quality testing, the Urgent alert, how results
//     are shown, and the Urgent and re-analysis risks. Anthropic receives no real
//     Google review before the Privacy Notice period ends; the first activation
//     runs on OpenAI alone.
//   - No waiting period (docs/BETA.md section 2): both beta Organizations are the
//     owner's.
//   - Not served: the "Anthropic subprocessors" link of the draft. Its target was a
//     placeholder and the notice invents no URL.
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
export const MERCHANT_AI_NOTICE_VERSION = 'merchant-ai-notice-2026-11-01.v1' as const

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
    'Choose which AI-assisted features RepKey may run for each selected property after reviewing how Google review data is minimized, retained, and sent to OpenAI and Anthropic, and what the analysis keeps.',
  sections: Object.freeze([
    Object.freeze({
      id: 'data_and_features',
      title: 'Data and selected features',
      body: Object.freeze([
        'RepKey may use the Google review body, star rating, review time, evaluated language, and property context needed for the selected feature, and facts your property chose to share with the AI. Property context includes the business category Google lists for the property, such as "Hotel", and example words RepKey picks for that category. Reviewer names, profile photos, Google identifiers, exact provider resource names, and raw organization, property, user, and review identifiers are excluded from the provider request.',
        "Before provider processing, RepKey applies automated minimization and redaction. It removes contact details, addresses, financial details, identifiers and secrets that it can recognise, and the reviewer's own name. It does not remove other names: if a review names a staff member or another guest, that name goes to the provider as part of the text. Other personal details can also be missed. A rotating pseudonymous safety identifier contains no raw actor, organization, property, or review identifier.",
        'Supported analysis groups are und, en-Latn, es-Latn, fr-Latn, de-Latn, pt-Latn, it-Latn, nl-Latn, pl-Latn, tr-Latn, uk-Cyrl, ru-Cyrl, ar-Arab, he-Hebr, hi-Deva, bn-Beng, ta-Taml, th-Thai, vi-Latn, id-Latn, zh-Hans, zh-Hant, ja-Jpan, ko-Kore, and bg-Cyrl. Explicit languages outside this catalogue are skipped before provider work.',
        'Review analysis keeps a record of what each review says about the business. The next section lists exactly what it keeps.',
      ]),
      links: Object.freeze([
        Object.freeze({ label: 'RepKey privacy notice', target: '/privacy' }),
        Object.freeze({ label: 'Merchant AI controls', target: '/settings/ai' }),
      ]),
    }),
    Object.freeze({
      id: 'analysis_record',
      title: 'What review analysis keeps',
      body: Object.freeze([
        "For each analysed review, RepKey keeps the results below, for one property only. None of the AI's results holds a sentence from the review or four or more of its words in a row.",
        'Topics and feeling. Zero or more of twelve topics: Staff and service, Speed and waiting, Booking and arrival, The main service, Food and drink, Cleanliness, Facilities and equipment, Price and billing, Atmosphere and noise, Location and access, Safety, and Communication. For each topic: praise, complaint or neutral, and mild, clear or strong. One overall sentiment for the review: positive, neutral, negative or mixed. A review such as "Ok" has no topic.',
        'Cause. A short note on the specific thing and what was wrong or right, such as "air conditioning" and "not working". Each part is one to three lowercase words, which RepKey asks the provider to write in English. RepKey refuses a cause that repeats four or more words of the review in a row, or that contains a word the review writes with a capital letter, such as a name, brand or place. A name written in lowercase can pass that check. Similar causes are grouped within one property, by fixed rules. A manager can rename, merge or hide a group.',
        'Evidence and names. The numbers of the sentences each result comes from, and whether a sentence names a team member, names someone else, or names nobody. RepKey keeps no sentence and no name.',
        'Urgent. The AI marks a review Urgent when a guest reports a risk to safety, a risk to health, discrimination, or a legal threat. RepKey keeps which of the four it is, and no details. It also keeps a level for each review (Urgent, High, Medium or Low), worked out from the answer and the star rating. The Inbox shows that level as a suggestion only.',
        "Also kept. The business category Google lists for the property: used only to pick example words, never shown, and removed when Google is disconnected. Daily counts of reviews by star rating for each property, with no review identity, for 24 months from the day they count. Manager corrections: kept beside the AI's answer, dropped when the guest edits the review, never sent to a provider.",
      ]),
      links: Object.freeze([]),
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
      id: 'provider_posture_anthropic',
      title: 'Anthropic processing posture',
      body: Object.freeze([
        "When RepKey uses Anthropic, it sends minimized and redacted inputs to Anthropic's API, through an account held by Mission Morph LLC, which has Anthropic's data-processing agreement. RepKey does not ask Anthropic to cache prompts.",
        "Under Anthropic's commercial terms, Anthropic does not train its models on content sent through its API. Anthropic states that it deletes API inputs and outputs within 30 days. Content it flags for policy violations can be kept for up to 2 years, and its safety scores for up to 7 years. There is no zero-data-retention promise and no promise about where Anthropic processes data.",
      ]),
      links: Object.freeze([
        Object.freeze({
          label: 'Anthropic privacy centre, API data retention',
          target: 'https://privacy.claude.com/en/articles/7996868',
        }),
      ]),
    }),
    Object.freeze({
      id: 'provider_use',
      title: 'Which provider is used',
      body: Object.freeze([
        'RepKey may use OpenAI or Anthropic for review analysis and reply drafting. RepKey chooses the provider for each kind of work and may change the choice without asking you to confirm again.',
        'Each attempt goes to one provider, and RepKey switches provider only on purpose. After a switch it may send unfinished work to the other provider and may analyse past reviews again. The two providers can judge the same review differently, so your counts and trends can shift.',
        "Quality testing. RepKey tests its analysis on a set of reviews. For properties that have enabled AI features under this notice, the set can include some of their reviews. A test can send the same minimized and redacted review to both providers, and a person at RepKey may read it, inside the app, to settle a disagreement between answers. RepKey keeps the review's own internal ID, the checked answers and how they were produced, never its text, and deletes them when they are 24 months old. A review leaves the set when Google no longer has it, when RepKey no longer holds its text, or when AI features are turned off for the property.",
      ]),
      links: Object.freeze([]),
    }),
    Object.freeze({
      id: 'limits_and_retention',
      title: 'Limits, retention, and revocation',
      body: Object.freeze([
        'Review analysis and reply suggestions accept at most 16 KiB of source and use a 70-second outer attempt deadline. Property trends accept at most 64 KiB and use a 100-second outer attempt deadline. Oversized or unsupported input is skipped rather than truncated into a different meaning.',
        'RepKey uses and shows raw review source for up to 30 days after it was last fetched from Google, and de-identified insights for up to 24 months. It deletes the results listed under "What review analysis keeps" when they are 24 months old. A group of similar causes is deleted when the newest result in it is 24 months old.',
        'Turning a capability off immediately denies new work, fences in-flight results, hides its prior outputs, and purges unpublished AI-assisted reply drafts. Erasure immediately denies access and purges persisted local AI content; an already-authorized in-memory attempt is discarded by its outer deadline. Both cover everything listed under "What review analysis keeps" and the answers kept for quality testing.',
      ]),
      links: Object.freeze([
        Object.freeze({ label: 'Privacy contact', target: '/privacy#contact' }),
      ]),
    }),
    Object.freeze({
      id: 'how_results_are_used',
      title: 'How results are shown and used',
      body: Object.freeze([
        'Summaries are built from the stored, de-identified analysis (counts, topics and causes), not from review text. RepKey writes them itself from fixed sentence patterns and calls no provider. This covers the daily property trend, the short lines at the top of Guest voice and the optional weekly email.',
        "Guests' words. Guest voice, issue pages and the Inbox can show the words of a review with the relevant part underlined. RepKey reads them from the review text it holds when a manager opens the page. It never copies them into analysis results, summaries, alerts, emails or reports. When RepKey no longer holds a review's text, there is nothing to show.",
        'Staff. The names result has two uses: Guest voice leaves out a quote that names a person, and it can say how many reviews praise a team member by name. It never says who, and it has no such line for complaints. RepKey does not count per person, and does not score, rank or evaluate staff from reviews.',
        "Alerts and emails carry no review text. A review marked Urgent can send one alert per review revision. It goes to the managers who receive that property's review notifications, in the app and by email as each manager's settings allow. The email says only that an urgent review needs you, with a link. It gives no reason. The reason shows only inside the app. A manager's own priority choice always wins over the AI's suggestion.",
      ]),
      links: Object.freeze([]),
    }),
    Object.freeze({
      id: 'human_control_and_risk',
      title: 'Human control and AI limitations',
      body: Object.freeze([
        'AI output can be inaccurate. Review analysis and trend summaries are decision support, not facts or professional advice. An analysis can mark a review Urgent when it is not, and can miss one that is. Do not treat the Urgent alert as your only way to find a serious report.',
        "Drafts may be prepared when a manager opens a review or asks for one. The AI provider drafts the reply body from the review text (numbered sentences), the rating, the language, the tone, and facts your property chose to share with the AI. RepKey adds the property's greeting, contact line, closing and signature locally. The draft is verified for language before it is shown; when the provider cannot produce a valid draft, a fixed application-owned localized starting point is offered instead. Suggestions remain editable and are never published without the existing separate human submit, approve, and publish workflow.",
        "AI output cannot publish a reply, change an Inbox item's status, assignment, escalation or priority, or decide anything about a person. The only message it can send on its own is an Urgent alert.",
      ]),
      links: Object.freeze([]),
    }),
  ]),
  capabilities: Object.freeze([
    Object.freeze({
      id: 'review_analysis',
      title: 'Review analysis',
      description:
        'Analyze new and materially updated eligible Google reviews, including marking a review Urgent.',
    }),
    Object.freeze({
      id: 'reply_drafting',
      title: 'Reply drafting',
      description:
        'Prepare an editable reply suggestion when a manager opens a review or asks for one.',
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
      value:
        'Up to 30 days after it was last fetched from Google, then no longer used or shown',
    }),
    Object.freeze({
      id: 'repkey_derivatives',
      label: 'RepKey de-identified insights',
      value:
        'Up to 24 months. The results listed under "What review analysis keeps" are deleted then',
    }),
    Object.freeze({
      id: 'provider_monitoring',
      label: 'Provider retention',
      value:
        'OpenAI: generally up to 30 days; documented legal or safety exceptions may be longer. Anthropic: inputs and outputs deleted within 30 days; flagged content up to 2 years; safety scores up to 7 years',
    }),
  ]),
  risks: Object.freeze([
    'Automated redaction can miss unstructured personal details. It does not remove the names of staff or other guests, and the check on stored causes can miss a name written in lowercase.',
    'AI analysis and suggestions can be inaccurate.',
    'An Urgent mark can be wrong, and a serious review can be missed.',
    'The two providers can judge the same review differently, so a change of provider can shift trends.',
    'When RepKey analyses past reviews again, topics, counts and trends can change.',
    'Provider retention has no guaranteed per-request deletion date, and content a provider flags can be kept longer.',
  ]),
  ctaTemplate: 'Enable AI features',
  requiresStepUp: false,
  processingRegion: 'global',
})
noticePayloadSchema.parse(MERCHANT_AI_NOTICE_PAYLOAD)

export const MERCHANT_AI_NOTICE_DIGEST =
  'e9574380fd1ba5f4b7bd7b9899bc5e6bdf371f9d9871584f33c5c1e6131290ef' as const

/** The notice a consent was recorded under, by version and digest. */
export type MerchantAiNoticeReference = Readonly<{
  noticeVersion: string
  noticeDigest: string
}>

/** Data-use changes relative to the notice replaced, separate from immutable text. */
export type MerchantAiNoticeChange = MerchantAiNoticeReference &
  Readonly<{
    replaces: MerchantAiNoticeReference | null
    materiallyChanges: ReadonlyArray<MerchantAiCapability>
  }>

export const MERCHANT_AI_NOTICE_CHANGES: ReadonlyArray<MerchantAiNoticeChange> =
  Object.freeze([
    Object.freeze({
      noticeVersion: MERCHANT_AI_NOTICE_VERSION,
      noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
      replaces: Object.freeze({
        noticeVersion: 'merchant-ai-notice-2026-10-30.v1',
        noticeDigest: 'dadad7b81dbda360678fc57f7265b104c7311cbc213f877f32306c53b4852a5e',
      }),
      materiallyChanges: Object.freeze(['reply_drafting'] as const),
    }),
    Object.freeze({
      noticeVersion: 'merchant-ai-notice-2026-10-30.v1',
      noticeDigest: 'dadad7b81dbda360678fc57f7265b104c7311cbc213f877f32306c53b4852a5e',
      replaces: Object.freeze({
        noticeVersion: 'merchant-ai-notice-2026-10-17.v1',
        noticeDigest: '2bcd2be15cbb81f324f9a9390ad00baff3ffbb25a6c0db8bff71fbb2b1b0975e',
      }),
      // The provider envelope and data-use promises changed for all three.
      materiallyChanges: Object.freeze([
        'review_analysis',
        'reply_drafting',
        'property_trends',
      ] as const),
    }),
    Object.freeze({
      noticeVersion: 'merchant-ai-notice-2026-10-17.v1',
      noticeDigest: '2bcd2be15cbb81f324f9a9390ad00baff3ffbb25a6c0db8bff71fbb2b1b0975e',
      replaces: Object.freeze({
        noticeVersion: 'merchant-ai-notice-2026-09-15.v1',
        noticeDigest: '6c98ae3bb57b5b142afed1749a1b9f59be8d6ca7edaca3250e39055897289a9c',
      }),
      materiallyChanges: Object.freeze([]),
    }),
  ])

/** Notices remain in force for each capability's unchanged data use (ADR 0074). */
const SERVED_NOTICE = Object.freeze({
  noticeVersion: MERCHANT_AI_NOTICE_VERSION,
  noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
})
const ANALYSIS_NOTICES = Object.freeze([
  SERVED_NOTICE,
  Object.freeze({
    noticeVersion: 'merchant-ai-notice-2026-10-30.v1',
    noticeDigest: 'dadad7b81dbda360678fc57f7265b104c7311cbc213f877f32306c53b4852a5e',
  }),
])
export const MERCHANT_AI_NOTICES_IN_FORCE: Readonly<
  Record<MerchantAiCapability, ReadonlyArray<MerchantAiNoticeReference>>
> = Object.freeze({
  review_analysis: ANALYSIS_NOTICES,
  property_trends: ANALYSIS_NOTICES,
  reply_drafting: Object.freeze([SERVED_NOTICE]),
})

export function isMerchantAiNoticeInForce(
  notice: MerchantAiNoticeReference,
  capability: MerchantAiCapability,
  inForce = MERCHANT_AI_NOTICES_IN_FORCE[capability],
): boolean {
  return inForce.some(
    (listed) =>
      listed.noticeVersion === notice.noticeVersion &&
      listed.noticeDigest === notice.noticeDigest,
  )
}

/** Settings renews consent if any selected capability needs a newer notice. */
export function isMerchantAiNoticeInForceForCapabilities(
  authorization: MerchantAiNoticeReference &
    Readonly<{
      capabilities: ReadonlyArray<MerchantAiCapability>
    }>,
): boolean {
  const capabilities = authorization.capabilities.length
    ? authorization.capabilities
    : (['review_analysis', 'reply_drafting', 'property_trends'] as const)
  return capabilities.every((capability) =>
    isMerchantAiNoticeInForce(authorization, capability),
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
  materiallyChanges: ReadonlyArray<MerchantAiCapability>
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
    materiallyChanges: MERCHANT_AI_NOTICE_CHANGES[0]!.materiallyChanges,
  })
}

export const CURRENT_MERCHANT_AI_NOTICE = parseMerchantAiNoticeCatalogueEntry({
  version: MERCHANT_AI_NOTICE_VERSION,
  digest: MERCHANT_AI_NOTICE_DIGEST,
})
