# AI — Context

**Audience:** Developers and agents working in `src/contexts/ai/`.

## Responsibility

The AI context owns governed AI authorization reads, operation admission,
provider-inference orchestration, derivative output lineage/lifecycle, Review
Analysis enrollment, deterministic Property Trends, and on-demand Reply Drafting.
It does not own Google Review source content, Property access, Inbox workflow,
Reply publication, Portal/Guest data, metrics, goals, or notifications.

## Boundaries

- Cross-context and presentation-facing types/events are exported only through
  `application/public-api.ts`.
- `build.ts` is the composition-root boundary. Other contexts do not construct AI repositories, provider adapters, jobs, or control stores.
- Server functions are authenticated delivery adapters; they call the built
  `publicApi` and are not domain authority. Every read `publicApi` serves for a
  reader takes that reader's `AuthContext` and authorizes it for the Property
  itself (`application/ai-property-read-access.ts`: same Organization, the
  read's permission held, current Property access) before the
  merchant-authorization gate is read; a refusal is a tagged `AiError`
  `forbidden`. The permission is the one the read's surface is gated on:
  `dashboard.read` for `readPropertyAggregates`, `readPropertyInsights` and
  `readReviewAnalysisProgress`, `ai.trends.read` for `readPropertyTrend`, and
  `inbox.read` for `readReviewAnalysis`, which Inbox calls through its
  `AiReviewInsightsPort` after it has authorized the item.
- Not reader-authorized inside the context: the two review-id filters
  (`findCurrentReviewIdsByAttention`, `findCurrentReviewIdsByAspect`), which
  return identifiers only and which Inbox intersects with its own authorized
  item query; the Organization spend read; and the two commands
  (`generateReplySuggestion`, `requestReviewAnalysisNow`), whose only
  authorization is still their server function's execution-policy decision.
- Review supplies one admitted current source snapshot. Portal supplies only the
  exact public display name, profile version, digest, and boolean currentness.
- Lifecycle export and purge contributors are never on `publicApi`; composing one
  does not arm its irreversible phase.

## Model

The fixed beta capabilities are Review Analysis, on-demand editable Reply
Drafting, and deterministic Property Trends. Property Trends aggregate completed
Review Analysis and never make a second provider-generation call.

All three are dark until the AccountAdmin authorization, live access, notice version, provider policy, platform gate, runtime catalogue, and cell-local admission/egress controls agree. Property Trends additionally requires Review Analysis. A capability being present in code or schema is not activation.

An authorization recorded under a notice the runtime catalogue does not hold
in force, or under another provider deployment profile than the one this build
serves, is refused before an operation is claimed
(`isAiAuthorizationUnderServedContract`, `application/ai-workflow-support.ts`).
The notices in force are the served one and each earlier notice whose data use
it repeats word for word (`MERCHANT_AI_NOTICES_IN_FORCE`): since 2026-10-17, which
changed only the call to action, a consent under 2026-09-15 keeps AI running and
binds its operations under its own version. A reply draft under a lapsed notice
answers `consent_renewal_required`, which the composer shows as the notice
needing an AccountAdmin's confirmation. A review is settled as not analysable,
with no operation: re-consent bumps the Review Analysis epoch and the enrollment
replay analyses the history again. The gateway's request check compares the
same catalogue values (`isAiRuntimeNoticeInForce`) and stays as the second line;
it throws, so it must never be the first.

Operations, settlements, derivative generations, enrollment heads, schedules,
and output lineage pin authorization, source, policy, model, and lifecycle fences.

## Source text

The text a model reads is made in two versioned stages. Review canonicalizes the
raw provider text and masks the reviewer's name (`ai-review-source-contract.ts`,
`ai-source-v1`); the gateway redacts that text at request time with the deployed
code (`gbp-review-global-v1` over `structured-marker-detectors-v1`, the second
with `ai-address-markers.ts`). Every operation binding records the canonicalizer
(`AI_SOURCE_CANONICALIZER_DIGEST_V1`), and the operation profile attests the
detectors and the redactor by digest, so a change to a rule moves a digest. Both
digests are recomputed from the code; no stored analysis, aggregate or Trend is
compared with them, so a bump hides nothing that was already produced. The one
exception is an operation still pending when the new build starts: its request
fingerprint includes the binding, so its next claim answers `conflict`, the
review is settled not analysable, and the reaper abandons the operation at its
expiry, after which the reopen pass queues the review again.

A change to these text rules is not an "analysis contract change" in the sense
of ADR 0031 (which bumps the capability epoch and re-analyses eligible history):
it changes what the next request sends, not the contract an analysis is stored
under, so it leaves the capability epoch alone and reaches only the reviews that
are analysed after it. If product wants the history analysed again under new
rules, the epoch bump is the lever (it moves with a Merchant AI authorization
transition, not a deploy); the options and their cost are listed in the pull
request that carried the change.

Changing what the canonicalizer produces is not a patch. The Review row stores a
digest and a byte length of the canonical text (`ai_source_digest`,
`ai_source_byte_length`), `readForAi` recomputes them from the raw row, and the
output store refuses a result whose operation digest differs from the Review's.
So a rule change needs a new text revision (`AI_SOURCE_TEXT_REVISION`) with:

1. the previous revision kept reproducible for one content lifetime (30 days,
   ADR 0031), only to recognise a digest stored under it;
2. `readForAi` serving a row under the revision its stored digest names
   (`matchStoredAiReviewSourceProvenance`), so no row turns `policy_unavailable`
   and the digests the AI context compares stay equal;
3. the Review sync treating a stored digest of the previous revision as
   unchanged (`aiSourceUnchanged`), so the row is rewritten quietly on its next
   observation instead of raising `review.updated`, a new analysis sequence and
   a manager notice for a review nobody changed;
4. a new `AI_SOURCE_CANONICALIZER_DIGEST_V1`, derived from the rules named in
   `ai-source-profile.test.ts`.

Revision 2 (2026-10-14) turns a line break or tab between two words into a space
(revision 1 deleted it and fused the words) and replaces Unicode noncharacters
with U+FFFD. Two things hold until a stored row is observed again (at most 25
days): the text it serves is revision 1's although an operation records the
current canonicalizer digest (the digest names the rules that produced the text
only after the next observation), and a row that holds a noncharacter fails
`encodeCanonicalAiReviewSource` where revision 1 let it through to the gateway
schema, which refused it later. A quiet rewrite that lands while a review's
analysis is executing makes the store refuse the result (`generation_changed`,
receipt `obsolete`) and opens no sequence; the reaper fails the abandoned
operation as `operation_ambiguous`, a code the reopen pass queues a review again
on. Two inputs the canonicalizer refuses (`AiReviewSourceRefusal`): a text of
16 KB or more after NFKC and a lone surrogate. They no longer fail the
Property's snapshot page: the Review writer stores the review (it is Google's
content and the Inbox and the reply workflow use it) with `ai_source_byte_length`
one byte over the limit (`REFUSED_AI_SOURCE_BYTE_LENGTH`) and a digest of the raw
fields, so every AI reader denies it as `source_too_large` and analysis settles
it as not analysable, exactly as for any oversize source. The review stays out
of the aggregates and the Trend. Nothing logs, counts or alerts on it: the
marker is the only trace, and `SELECT count(*) FROM reviews WHERE
ai_source_byte_length = 16385 AND source_content_state = 'active'` sizes the
decision. A reply suggestion for such a review answers `source_changed`
(`generate-reply-suggestion.ts` maps every status but `available` to it), which
the author sees as a retryable failure, so the Inbox shows a suggestion button
that cannot succeed for it. Whether the AI should ever read such a review is a
product question: leave it skipped (today), or truncate it at a scalar boundary
(the model reads part of what a guest wrote, a new text revision), or for a lone
surrogate read it as U+FFFD (a new text revision). Either change must follow the
bump list above, and its item 3 then also has to recognise the refused marker
(the over-the-limit length and the digest of the raw fields) as unchanged for
the same observation, or every stored refused review would raise `review.updated`
and a manager notice on its next sync.

Redactor and detector changes need none of this: they act on the next request and
change no stored value. A review the redactor blocked stays settled as not
analysable (`redaction_blocked` is not a reopen code, `review-analysis-reopen.ts`)
until something gives it a new analysis sequence.

The address detector (`ai-address-markers.ts` for the number-first, street-first
and Bulgarian layouts, `ai-address-number-last.ts`, `ai-foreign-address-markers.ts`,
the decision in `ai-address-name-rules.ts`, the word lists in `ai-address-words.ts`)
finds the shapes with patterns and decides in code whether the words are a
street's name or a clause of a review. It reads the number first (`25 Main
Street`, `7 oak lane`, `12 de la Rosa Street`, `12, Oak Road`, `12 St.James
Street`, `Twelve Oak Road`), the street-type word first (`100 Boulevard
Saint-Germain`, `8 place de la concorde`), the number last (`Main Street 25`,
`Baker Street 221B`, `Oak Road (no. 12)`, `Oak Road 12/3`, `oak road 12`, `Pl. de
Catalunya 5`), Bulgarian street words (`ул.`, `бул.`, `ж.к.`), street types
beyond thirteen when the name is written in capitals (`Close`, `Crescent`,
`Gardens`, `Square`, `Terrace`, `Walk`, `Row`... and `50 Broadway`), streets of
other languages (`12 rue de la Paix`, `Calle Mayor 5`, `Via Roma 10`,
`Hauptstraße 12`, `Kungsgatan 12`, `Atatürk Caddesi No: 5`), and whatever follows
`Address:` and its translations when it holds a digit (`Address: Karlova 12`).
Each takes the city and postcode that follow on the same line. A real address
followed by another street-type word (`12 Oak Road. It was a great place`) is
read again with the window cut before each street-type word, longest first, so
the shorter reading that is the address is found.

Capital letters are the evidence: a capitalised name is a street unless it holds
a word no street carries (`was`, `to`), follows an article with a count or praise
in the name (`a 5 Star Place`; `Flat A 12 Oak Road` and `the 5 Park Lane` are
addresses), or is a title-case clause (`5 Nights Near Main Street`). A unit or a
span of time in a capitalised name is a street's own before a street, road or
avenue (`12 Miles Avenue`, `40 Weeks Street`, `9 Pounds Lane`) and, before a
drive, a way or a place, unless a word that makes the number a measure leads
(`Only 2 Minutes Drive`, `It is 5 Minutes Drive`, `within 10 Min Walk`, an article,
a rating label) or the number starts a sentence (`Taxi to 7 Days Way` is an
address). `on`, `in` and `upon` between two words are a place's (`Henley on
Thames Road`).
A name in lower case must hold none of the everyday words (`down`, `this`, `star`,
`great`), and before `place`, `drive` and `way` no count or praise, unless a word
introduces the address: after `at` or within three words of `address`, a name of
up to three words is a street (`We stayed at 12 love place`, `12 all saints
road`), and a capitalised short name too (`12 About Road`). Function words and
plural spans of time in a lower-case name still rule it out. The layouts added
for recall ask more of prose: a count word, `am`, `pm`, `stops` or `out of` after
a number, a name that is only praise or a generic noun, a spelled-out number
before a unit, praise or glue word, a street-first number not followed by the end
of a clause, and a Bulgarian name that is not in capitals are prose.
`ai-redaction-ordinary-prose.test.ts` and `ai-redaction-recall.test.ts` pin both
sides. What still reaches the provider, pinned there too: a lower-case name
holding an everyday word with nothing that introduces the address (`7 wonderful
place`, `1400 mile end drive` after `near`), which is `a 5 star place` and `a 10
mile drive` in prose; a lower-case name that is a function word, a particle alone
or a plural span of time (`12 not road`, `12 of street`, `12 weeks place`: no street
is named so); a foreign street with no type word and no label (`Karlova 12`);
street words of languages not listed. The Property market is Bulgarian, so Latin
and Cyrillic street words are read; the other languages are an owner decision.

Coordinates (`ai-coordinate-markers.ts`) are read as a pair of decimal degrees
with a comma, a semicolon, a blank, a slash, a bar, an `x`, a hyphen, `&lon=`,
`and long` or labels in brackets between them; with degree signs and hemisphere
letters; in ISO 6709, in degrees with minutes (and seconds), in NMEA; three
decimals after a dot, four after a comma, or fewer after `GPS`, `Pin:`, a label
or a hemisphere letter. `Prices were 12.50, 14.75` and `Kurs 1,0850 1,0920` are not
pairs. IP addresses (`ai-network-markers.ts`) are read with a port, in brackets,
zero-padded, in the four-byte hexadecimal form, after a label and before full
stops or colons. A bare domain is told from a number by its last label (two
letters or more, starting with a letter).

A line break is a blank in the canonical text, so a token it split reaches the
redactor in two pieces (`ai-broken-token-markers.ts`): a domain (`hotelsun
rise.com`, `hotelsunrise .com`, `hotelsunrise. com`, `hotelsunrise.c om`), an
email split beside a dot, an underscore or a hyphen or inside its domain, an IP
address, a coordinate, a short handle, a passport number, a street whose type or
name a break split. The blank before a dot reads a name as a domain's only when
the name is lower case and long, holds a digit or a hyphen, or is in camel case
(`Booking .com said` is prose). What a break through the middle of a word still
leaves, pinned in `ai-redaction-recall.test.ts`: the first half of an email's
local part (`joh` and `n.smith@gmail.com`; `wrote owner@example.com` cannot be
told from it), a split passport label (`pa ssport`), an IPv6 address split
inside a group, the tail of a URL path. The detectors read a word glued to a full
stop (`hotel.Staff`, `Dr.Smith`) as a domain, because nothing separates it from
`example.Com`. Taking any of the rest is a change to the detectors' digest and a
decision, not a patch.

## Review analysis v3 contracts (dark)

The shape of a v3 analysis lives in `src/shared` and nothing selects it: no operation
profile, runtime catalogue row, merchant notice or deployment profile serves it
(`review-analysis-v3.test.ts` fails if a profile or the catalogue does). It replaces the
eighteen aspects, the -100 to 100 intensities and the issue label with twelve universal
topics (`review-topic-taxonomy.ts`) and one mention per topic, thing and polarity: a strength
(`mild | clear | strong`), an optional cause (`thing` and `issue`, lowercase, at most
three words each), the one-based sentence numbers that state it (`review-sentences.ts`,
the rule the live display will run on the original text) and a names flag. No quote,
name or sentence text is stored.

Every provider's answer passes one normalizer before it is stored
(`review-analysis-v3-normalizer.ts`, `review-analysis-normalization-v1`). Only an answer
that is not an object, has no `mentions` array or has no valid sentiment fails an answer
already paid for; any other fault is repaired, or the mention is dropped and counted, and
the result carries closed, content-free flags. A cause that holds a person, brand or
place word (a capitalised word of the review that is neither a common word nor one of the
request's vocabulary hints) or that repeats four or more contiguous words of the review is
refused and its mention stays as a topic-level mention. Attention v2
(`deriveReviewAttentionV2`) is derived from the stored answer and the star rating; Urgent
exists only when the provider reports one of its four reasons. `aspect-taxonomy-v1` and
every v2 schema stay as they are for history.

Storage for it exists and stays empty until activation (migration 0078, `ai-review-analysis-v3.schema.ts`; the analysis flow below writes it behind the runtime selection):
`ai_review_analysis_mentions` and `ai_review_analysis_mention_sentences` for the analysis,
`ai_property_aggregate_contribution_mentions` for the same mentions under the contribution
that retracts with them, `ai_property_review_population_daily` for the reviews of a local
day by stars (star-only reviews included), `ai_review_analyses.urgent_reason`, and lineage
columns on `ai_operations` (provider, model, request profile, vocabulary hint set,
normalizer, and once settled the closed flags it raised). `ai_review_analyses_result_valid`
tells the two shapes apart by `analysis_profile_version`: a v3 row has no primary category
and no issue label, and carries an Urgent reason exactly when its attention is urgent. A
CHECK passes on an unknown, so each v3 arm states IS NOT NULL beside a comparison. The
execution-control scopes also admit `provider` (`provider:openai`, `provider:anthropic`).
Every v3 derivative expires 24 months after it was generated: the sweep deletes the analysis
on `expires_at` (`ai_review_analyses.v3_expired`, v3 rows only) and the three mention tables
go with it by cascade; the daily star counts have a rule of their own, counted from the day
they are for (`retention-registry-ai.ts`). Nothing in them is a quote, a sentence, a name or a
provider response.

Vocabulary hints steer the `thing` of a v3 mention (`review-vocabulary-hints.ts`,
`review-vocabulary-hints-v1`). A set is chosen from the Property's Google primary
category (`PropertyVocabularyContextPort`, read from `properties`) by an exact alias
after NFKC, whitespace, trim and case-folding, with no substring guessing, and falls back
to `generic-service`. `resolveReviewPropertyContext` returns the `propertyContext` the
request will carry (the category as stored, the set id and version, the hints) and the
`VocabularyHintIdentity` (id, version, digest) to record. The identity belongs in the
request fingerprint and goes to `AiOperationStorePort.claim`, which stores it on
`ai_operations.vocabulary_hint_set_*` and answers `conflict` when a claim under the same
key names other hints. Hints are request context, not analysis semantics: they are in no
operation-profile or runtime digest (`review-vocabulary-hints.test.ts` changes a hint and
shows the logical-artifacts digest does not move), so adding a kind of business or editing
a hint reaches the next request and re-analyses nothing. The catalogue is pinned by a
manifest so an edit is a reviewed change; a hint change that needs a new topic, cause shape
or normalizer rule is not a hint change.

### Evidence request path (dark)

A v3 request carries the review as numbered sentences (`review-analysis-v3-request.ts`,
`ai-provider-control/review-evidence-request.ts`). Review cuts the RAW text with
`review-sentences-v1` and canonicalizes each sentence (`readForAi` with `sentences: true`),
so sentence `n` is the sentence the live display underlines for a stored pointer `n`; the
request's `source.text` stays the whole canonical text, so the operation's source digest is
the one v2 computes and the gateway checks that the sentences are that text, cut and
numbered from one (`reviewSentencesMatchText`). Only a binding that names
`review-analysis-v3` may carry sentences and a `propertyContext`, and the live catalogue
holds no such entry, so the transport refuses a v3 request as cross-wired until activation;
a v2 request that carries either is refused too. The property context must be what
`resolveReviewPropertyContext` yields for its category.

The preparer sends `{ rating, languageCode, propertyContext, sentences: [{ number, text }] }`
and no `reviewText`. The sentences are redacted from one scan of the review joined by single
spaces (`redactAiReviewSentences`), so a marker a line break cut in two is read as one and
written into each sentence it touches, the limits (64 intervals, three fifths) are the
review's as they are for the whole text, and no sentence loses its number. That redaction is
then compared with `redactAiReviewText` of the whole canonical text, the fence that has
always run (`reviewRedactionsAgree`): when they differ the review is `redaction_blocked`, so a
sentence-wise redaction is never weaker than v2's. The contract's "redact each sentence
independently" would leak a phone number or an email broken across lines; this does not.

`acceptProviderResult` is the one point where a v3 answer becomes the stored contract
(`normalizeReviewAnalysisV3` over the sentences the provider read). It answers
`{ contract: 'review-analysis-v3', answer, normalization: { version, digest, flags,
droppedMentionCount } }`, which the response schema accepts beside a v2 answer. Only a
top level that is not usable is a billed `output_invalid`. `AiGatewayRoutePreparer` takes its
profiles as a dependency (the live catalogue by default), which is how the dark path is
exercised without a live entry. The in-process adapter gives a v3 request a bound of
98,304 bytes (v2 keeps 65,536): 512 sentences of 30 characters, all needing a JSON escape,
are the largest request the Review limits allow and fit under it.

### Provider seam (dark)

Providers sit behind one interface (`ai-provider-control/provider-contracts.ts`): an adapter
shapes the exact request (`prepare`, no credential), makes the one call (`invoke`) and says
what it charges (`pricing`) and what request profile it pins (`requestProfile`: model, kind,
attestation digest). OpenAI is the first adapter (`openai-provider-adapter.ts`); its `prepare`
is the request building the route preparer used to do inline and its `invoke` is the
connector, both unchanged. `openai-v2-parity.test.ts` pins, as literals taken before the seam
existed, every v2 profile digest, the deployment profile and, for each route, the descriptor,
the request binding and the SHA-256 of the exact body sent to OpenAI; it passes unchanged at
the commit before the seam and after it.

Switching providers is an operator's act and nothing else (decision 7,
`provider-selection.ts`). The operator names a provider per capability
(`createAiEgressRuntime({ providerSelection })`; there is no environment variable until
activation needs one). A profile attested for one provider is served by it and ignores the
choice, so naming Anthropic moves no v2 operation. A profile attested for several is served by
the provider named and by nothing else: when its adapter is missing or not ready the answer is
a closed refusal (`policy_unavailable`, or `provider_unavailable` for a provider that is down),
never the other provider, and a refusal, overload, quota stop, truncation or ambiguous dispatch
from the chosen provider is the answer to the caller whichever provider it was. The provider
the preparer selects is the only one the gateway hands the invocation to
(`PreparedGatewayRouteExecution.providerId`; no adapter for it is refused before admission
reserves anything). A v3 request names the provider it was claimed under
(`provider: { id, model, requestProfileVersion, requestProfileDigest }`) and the preparer
ends it with `provider_profile_changed` when the provider in force differs or was
re-attested: an operation does not follow a switch, a new one is claimed, and the claim
records the provider (`AiOperationStorePort.claim` `providerLineage` and `normalization`,
columns of migration 0078; the same key under another lineage answers `conflict`). Moving the
history to the other provider is a new review-analysis epoch, so one evidence window never
mixes two models' judgements.

An operation profile used to hash its prompt and schema beside OpenAI's request shape and
the token count of OpenAI's wrapper. It is now two things. The logical profile
(`ai-logical-operation-profile.ts`) is the operation in no provider's terms: prompt, answer
schema, the artifacts it reads (taxonomy, sentence rules, normalizer, attention formula, source
rules) and limits, with a `logicalDigest` that moves for those and for nothing a provider does.
A provider's attestation (`ai-provider-attestations.ts`; OpenAI's, `ai-openai-provider-attestation.ts`,
restates the deployment contract it already had) covers model, SDK, request shape, endpoint,
name resolution, headers, usage and status mapping, price list, rate limit and posture, with its
own digest. A pairing (`AiOperationProviderPairing`) is one provider's carrying of one logical
profile: the wire schema it derives and the static tokens a reservation prices. The profiles in
force are untouched; `ai-operation-profile-views.ts` reads each as logical profile plus OpenAI
pairing and builds it back with every digest intact (`ai-operation-profile-views.test.ts`),
and is how the dark v3 profile (`review-analysis-v3-profile.ts`, with its prompt from the
annotation guide) becomes a catalogue entry at activation. `defineProviderDeploymentEnvelope`
names every provider of a deployment by attestation digest (`private-beta-global-v2` is built
from both at activation, when the Anthropic attestation exists); choosing one of them is not an
input to it.

Cost follows the provider. A reservation is `maximumCostMicrosWith(adapter pricing, profile,
payload bytes)` from the tokens the provider's pairing reserves; a settlement is
`settledCostMicrosWith` over the price list of the provider recorded on the operation
(`AI_PROVIDER_PRICE_CATALOGUES`; none recorded means OpenAI). The gateway checks the signed
receipt against the same list, a provider with no list or no pairing is refused, and nothing
falls back to OpenAI's.

### Anthropic adapter (dark)

`ai-provider-control/anthropic/` is the second adapter behind the seam. Nothing selects it: no
environment variable, no runtime registration, no catalogue entry, no key. It never calls the
real API, in code or in a test: `messages-stub.test-fixtures.ts` and the `/v1/messages` route of
the e2e provider stub (`e2e/fixtures/ai-provider-stub.ts`) are Messages-shaped fakes.

- The request (`request-profile.ts`, `request-builder.ts`) is one Messages call: model
  `claude-haiku-5-5` (an alias, the provider publishes no dated id for the 5.x line, so the
  evaluation harness and activation re-pin it), `anthropic-version 2026-10-21`, the versioned
  developer prompt as `system`, the redacted data block as the only user message, the
  per-Property `rk1_` safety identifier as `metadata.user_id`, and `output_config.format` (JSON
  schema) with `effort`. Reasoning effort maps none to thinking disabled at low effort, and low,
  medium, high to adaptive thinking at the same effort. No temperature, top_p, stop sequences,
  tools, streaming, `cache_control` or beta header.
- Structured outputs on this provider reject some JSON Schema keywords and enforce none of the
  bounds, and enum casing is not guaranteed. `schema-transform.ts` keeps the supported keywords,
  folds `maxItems`, `minimum`, `maxLength`, `pattern` and the rest into the description, and
  refuses a schema over 24 optional or 16 union parameters. The connector therefore returns the
  parsed JSON object as the provider wrote it, billed, and `acceptProviderResult` (the v3
  normalizer) stays the single acceptance point (contract 1.3).
- The transport is the OpenAI connector's boundary made provider-neutral
  (`connector-boundary.ts`, used by both connectors; the OpenAI path is behaviour-identical and
  `openai-v2-parity.test.ts` still passes unchanged): the grant and nonce gate, an exact header
  allowlist for the SDK's own request, byte equality with the attested RFC 8785 bytes, pinned
  name resolution to `api.anthropic.com`, HTTP/1.1 with one request per dispatcher, no redirects,
  bounded reads, no SDK retries. The SDK sends `Authorization: Bearer`; the boundary sends five
  fixed headers outbound with `x-api-key`. `@anthropic-ai/sdk` is an exact pin (1.3.0, held from
  grouped dependabot bumps) imported and constructed only in `anthropic/connector.ts`
  (`provider-client-singleton.test.ts`), and `ANTHROPIC_API_KEY` is named nowhere in production
  code.
- A 200 is read by `response-interpreter.ts` and `usage.ts`. A refusal is a billed
  `provider_refused`; `max_tokens` and `model_context_window_exceeded` are `output_truncated`;
  any other stop reason, or content other than exactly one text block (thinking blocks aside),
  is a billed `output_invalid`. Input tokens are input plus cache reads plus cache writes,
  thinking tokens come from `output_tokens_details`, and the usage is read independently of
  every other field, so a billed answer keeps it whatever else is new in the body.
- The error taxonomy (`dispositions.ts`): 529 and 500, 502, 503, 504 are a retryable
  `provider_unavailable` with zero usage; 429 is `rate_limited` with the delay it names. A spend
  limit or an empty credit balance is `quota_exhausted`, never retried and not a circuit
  failure: status 402, a 400 `invalid_request_error` whose message opens with the documented
  usage-limit or credit-balance sentence, and a 429 carrying
  `details.error_code: enforced_spend_limit_reached`. Every other status follows OpenAI's table.
- `attestation.ts` seals the Anthropic provider attestation and `anthropicPairingOf` carries a
  logical profile (`REVIEW_ANALYSIS_V3_ANTHROPIC_PAIRING`). The posture claims (30-day API
  retention, flagged content for up to two years, no zero-data-retention unless agreed, no
  training on customer content under commercial terms) and the 1,024 tokens a reservation adds
  for the provider's own structured-output prompt are provisional: 3.10 confirms the claims with
  counsel and WP0 replaces the allowance with a measurement. The Haiku 5.5 price list ($0.10 input,
  $0.01 cached input, $0.50 output per million tokens) is registered in
  `AI_PROVIDER_PRICE_CATALOGUES` as a non-enumerable property: a settlement recorded against
  Anthropic is priced by it, while the live catalogue's enumerable surface is unchanged.

Left for the slices that need it, not done here: the
`AI_OPERATION_PROFILES` entry, the runtime catalogue row, the notice, the `private-beta-global-v2`
envelope, an Anthropic key, the adapter's registration in the egress runtime and a real-provider
synthetic canary (3.10); a `provider` execution-control head and its place in the stop fence (the
binding schema lives in `ai-internal-transport-contract.ts`, which is at its file-length ceiling
and must be split first, and PR-3 has no migration number left to seed heads); `openai-usage.ts`
resolving the input ceiling of a profile that is not in the live catalogue.

### Analysing, storing and aggregating v3 (dark)

`analyze-review-event.ts` is one skeleton (authorize, read the source, claim, call the provider,
store, settle). The v2 and v3 analysis differ at six points of it, and a
`ReviewAnalysisContract` (`review-analysis-contract.ts`) names them: the profile facts the binding
and the authorization gate compare, whether the source read also returns the numbered sentences,
what is prepared before the claim, what the provider request carries beyond the review, whether a
Property's authorization was recorded under the contract this one serves, and how the answer is
accepted and stored. The use case knows none of it. The v2 contract
(`review-analysis-contract-v2.ts`) is everything that used to run inline there, moved without
change (profile facts, answer schema, the issue-label refusal, the attention formula, the call
that stores the analysis), and is the default of the use case: a v2 claim and provider request
are byte-for-byte what they were. `review-analysis-runtime.ts` builds v3 only when the live
runtime catalogue names `review-analysis-v3` for `review_analysis`; the catalogue holds v2 alone
and its parser refuses anything else, so no build runs v3 until activation widens it.

What the v3 contract (`review-analysis-contract-v3.ts`) does that v2 does not:

- Before the claim it reads the Property's Google primary category through
  `PropertyVocabularyContextPort`, resolves the vocabulary hints, and asks `AiProviderChoicePort`
  which provider the operator has chosen. A category the hint resolver refuses, a review whose
  sentences the source cannot give, or no provider are refusals the review waits out within its
  horizon (`property_context_invalid`, `sentences_unavailable`, `provider_unavailable`,
  `provider_selection_required`), never a verdict on the review. The port is declared and not
  wired: `build.ts` hands the use case `unavailableProviderChoice`, so even a catalogue that
  selected v3 would wait for the activation slice to name an operator choice.
- The claim records the lineage the database requires of a v3 operation: the hint set, the
  provider, model and request profile, and the normalizer. The request carries the numbered
  sentences, the hints (never the Property's name) and the provider it was claimed under, so the
  gateway can end it with `provider_profile_changed` after a switch.
- The answer is the gateway's normalized one, checked by `reviewAnalysisV3GatewayResultSchema`
  and never the provider's own. Attention is derived with the v2 formula
  (`deriveReviewAttentionV2`) from the stored answer and the star rating, then the analysis is
  stored through `AiOutputStorePort.storeAnalysisV3`. An answer that fails the schema is a
  charged `output_invalid`, exactly as a v2 answer that fails its schema is.

`storeAnalysisV3` writes, in the transaction the v2 write uses and under the same guards (the
source epoch and revision, the authorization lineage, the review analysis epoch, the operation's
attempt), one `ai_review_analyses` row (`ready`, no primary category, its Urgent reason when its
attention is urgent), the mention rows and the sentence numbers each cites
(`ai-review-analysis-mentions.ts`), and completes the operation with the closed normalization
flags and the count of mentions dropped. `analysis_profile_version` and the shape of the row
must agree (`analysisProfilePairValid`): a v2 profile with mentions or a v3 profile with a
primary category is refused before it reaches the database check. The same transaction files the
Property's aggregate contribution: a v3 contribution is a `ready` contribution with no primary
category, described by a copy of the mentions
(`ai_property_aggregate_contribution_mentions`) that retracts with it. The daily v2 cube is not
touched by a v3 analysis (statistics read the latest effective contributions and their mentions
directly), and the legacy window excludes v3 contributions, so a Property that moved between
contracts never mixes the two in one number.

A current-analysis read answers `{ status: 'ready_v3', topics, urgent reason, ... }` for a v3
row: topics, polarity, strength, the optional cause and the names flag, never a quote or a
sentence. Nothing above the AI context consumes it yet: `composition.ts` maps it to `none` for the
Inbox until the Inbox learns to read it.

Left for the slices that need it, not done here: the `ai_property_review_population_daily`
projection (it follows a review's observation, update and deletion whether or not the review is
analysed, so this flow does not write it) and the statistics that read the mentions (the Guest
voice read model, PR-4); wiring `AiProviderChoicePort` to the operator's provider choice, the
runtime catalogue row and the served-contract constants (`isCurrentAuthorizedEffect`, the
deployment profile string) that activation flips (3.10); the Inbox reading `ready_v3`; including
v3 derivatives in an organization export.

## Runtime

Identity's merchant-AI fact drives one durable lifecycle command, which opens a
freshly queued enrollment's replay on delivery. The unconditional one-minute
enrollment sweep recovers first-enablement intent; outbox receipts and
operation state, not BullMQ delivery or in-process callbacks, are recovery
authority.

Provider calls are admitted once per lane before an execution attempt is
claimed (ADR 0058): interactive work (reply drafts, on-demand analysis) and
background work (history) have independent global, organization and property
buckets. Historical and backfill analysis events queue their provider work in
`ai_review_analysis_backlog`, which a 5-second drain empties newest review
first, eight analyses at a time, and records an enrollment caught up as soon as
its last review settles; a review opened in the Inbox is analysed ahead of the
queue. The drain's schedule is tenant-cross, so it asks current platform policy
about each claimed entry's own Organization and Property before analysing it
(ADR 0032): an entry refused by the kill switch, a suspension or the allowlist
goes back to the queue untried, with no attempt counted and nothing settled,
and is analysed once the stop is lifted. A review that arrives during a stop
waits in the backlog as well (ADR 0058, 2026-10-13). The analysis consumer's
catalogue row is ungated, because a refused consumer is never retried: before
it analyses an ongoing review on delivery it asks the drain's policy question,
and a review policy refuses is queued after the checks that need no provider
call. A stopped AI execution control (killed or draining at the global,
provider or capability scope, or a missing head) is answered `stopped`, never
settled: the consumer queues the review, and the drain and the on-demand job
return it untried until the control accepts work again. A review that was
tried before such a stop cannot resume its operation, which is bound to the
control generations it was claimed under: after the restore its claim answers
`conflict`, the analysis closes that pending operation as `execution_suspended`
and settles the review against it, and the reopen pass queues it again
(`application/analysis-claim-conflict.ts`). The sweep also reopens a text
review whose analysis settled without a result because its operation gave up
on a transient failure (ADR 0058, 2026-09-29): a fresh analysis sequence and a
backfill event, at most three times per revision. An enrollment is not caught
up while one of its replayed reviews still owes an analysis. The replay and the
reopen pass lock the Property's source fence before their enrollment row and
reviews, the order Review writers and authorization changes take (ADR 0060).
`readReviewAnalysisProgress` reports queued, running, analysed and
not-analysable counts. Reply Draft provider output remains session-ephemeral until an explicit,
atomically revalidated adoption creates Review-owned draft content.

Property Trends compare the latest 30 complete Property-local days with the prior 30. Readiness requires at least 20 analyzed text Reviews, at least 90% coverage,
and a caught-up enrollment; incomplete settlement coverage reports
`preparing`/`Updating` rather than a fabricated zero. A window with no text Review
has nothing to analyse, so it is not incomplete: it reports `insufficient_data`
(`trendWindowIsIncomplete`, `src/shared/ai-property-trend-minimums.ts`, which the
Guest voice page reads too, so a stored `updating` report whose windows are all
complete is worded as insufficient data). Before 2026-10-29 its stored coverage of
0 (0 of 0) read as below 90% and left every quiet Property in `Updating`.

Guest voice (`readPropertyInsights`) counts Reviews, not mentions: a Review that
names a topic twice counts once (`aspect-review-evidence.ts`, shared with the 30-day
aggregate read of Overview). Per topic and polarity it reads the Reviews, their
stars as how many gave 1 to 5, those stars against every other Review in the window
(the Reviews with only stars included here; the aggregate read has analyses only, so
its "rest" is Reviews with text), and, against the Property's own previous 12 months
(the 365 days that end the day before the window starts, whatever its length; a
12-month window reaches back to the 24-month retention), whether the share moved
more than its usual ups and downs (`guest-voice-statistics.ts`, the engine
`GUEST_VOICE_STATISTICS_VERSION` names). Both shares are uncertain, so they are
compared as two posteriors and a change is called at a two-sided 95%; a unit test
enumerates both binomials exactly and pins an unchanged topic's false flags at 5% or
less (rates of 10% and 30%, windows of 20 and 60 Reviews, a baseline four times the
window). Without 20 analysed Reviews with text in those 12 months the change is
unknown. A Property with too many Reviews to read the window with its 12 months
(10,001) is read for the window alone and claims no change. The window is `auto` by
default: the shortest of 30 days, 90 days, 6 months and 12 months holding 60 Reviews
with text, or 12 months, with `enoughForPatterns` false under 10 in the year; a year
too full to read is answered with 90 days. A recurring issue is a label two or more
Reviews carry. Topics still come from the v2 analysis (taxonomy v1), where Staff and
Service overlap, so a Review about the front desk can count under both.

The aggregate head counts every sequence the settlement ledger settles for its
profile generation, including one a newer sequence of the same review had
already superseded, so coverage can complete. A head that is the only head of
its epoch is set to the ledger's count each time it counts, so one that missed a
sequence earlier is corrected by the next settlement of its Property; a rolled
profile generation has a sibling head, counts only its own settlements, and is
never set from the ledger, which spans generations. A review whose newest
sequence settles without an analysis (deleted at Google, expired, its text
removed, its analysis abandoned) is withdrawn from the daily aggregates, so a
day counts only reviews analysed at their current sequence. A Trend schedule the
head has moved past is stale, not retried. Two kinds of data written before
those corrections are not repaired by the code: a head short of the ledger, and
a review that stayed in its days after it was deleted. `docs/operations/runbooks.md`
§22 gives a read-only statement that finds each, and a statement that recounts
the first; the second is not withdrawn, and what it holds is de-identified
insight data under the 24-month retention of `docs/BETA.md` §2.

Coverage owes a settlement for every sequence after the authorization's start
up to the Review head, except the ones Review gave back. The Review writer
records a sequence it allocated and did not use (a replayed or out-of-order
observation) in `review_ai_analysis_released_sequences`, and every reader of
coverage subtracts the released numbers of the same source epoch that lie in
that range and that no settlement already counts: the stall monitor
(`alert-aux-reads.ts`), the aggregate read, the trend scheduler and the trend
report (`releasedAwaitingSequenceCountSql` in
`src/shared/db/review-analysis-released-sequences.ts`). AI never writes the
ledger. Its own allocations (the reopen pass and the enrollment replay) stamp
the number on a review and announce it in the same transaction, or roll back.
`pnpm ops ai release-orphan-sequences` records the numbers a past leak left
(ADR 0058, 2026-10-22). `pnpm ops ai-reopen-analyses` reopens, past the
three-reopen budget, the reviews a lasting outside cause left settled without
an analysis (`listSpentReviewAnalyses` and `reopenSpentReviewAnalyses` in the
reopen adapter, the sweep's own path; ADR 0058, 2026-10-25).

The recurring recovery passes treat each row on its own. The operation reaper
recovers every ownerless operation it lists independently, and the enrollment
sweep every enrollment, so one that keeps failing is logged by identifier and
counted (`candidatesFailed`, `enrollmentsFailed`) without stopping any other
Organization's recovery, and the job logs its completion line at warn while the
count is above zero. A row the operation listing cannot parse is skipped by the
listing, reported to the reaper by identifier and counted the same way. A failed
analysis operation is a reaper candidate only while its origin event is still in
the outbox and unreceipted: the retention sweep deletes a published event, and
its receipts with it, 30 days after publication, and a receipt cannot be written
for an event that is gone.

## Invariants

1. AI processes only currently eligible Google Review content loaded through the Review public source port plus the exact public Property display name loaded through Portal's narrow Brand authority. Brand image URLs, colors, localized content, Private Portal ratings, feedback, contact details, Inbox notes, manager-internal text, and Guest media never enter AI admission, prompts, outputs, logs, or derived tables.
2. Every operation is fenced by Organization, Property, source epoch, source revision, authorization epoch, capability epoch, policy/profile versions, model/deployment, idempotency key, and lifecycle generation.
3. Authorization is a maximum allowed capability set. A PropertyManager may operate only within the AccountAdmin-authorized set and current Property access; operating a feature never expands authorization.
4. Disable fences new and in-flight work immediately and hides outputs. Erasure purges local derivatives within the policy window while retaining only content-free evidence. Re-enable reuses an output only when every lineage, policy, model, authorization, and freshness fence still matches. An adopted Reply draft is Review-owned, so the control, Authorization and profile transitions withdraw the unedited ones in their own transaction through the AI draft purge (`src/shared/db/ai/ai-draft-purge.ts`; the rule is in the Review context's Model): a Reply nobody confirmed is deleted, and a confirmed one that has not been dispatched is cancelled and emptied while its publication authorization stays as evidence. A Reply whose publication already failed keeps its text, and Review's publish worker withdraws it the same way when a manager tries it again: its read of Google before the claim (an observation of the Review) withdraws it once the ten-minute adoption window has passed, and the claim refuses it when an input changed, claimed before or not.
5. Provider output is advisory. It cannot mutate Inbox status/assignment/escalation, publish a Reply, change Portal behavior, alter a Goal/Metric/Recognition result, or trigger workforce decisions.
6. Reply Drafting is never cached as a generic suggestion detached from the Review revision or Brand Profile version. A manager must explicitly request it, may edit it, and must separately adopt, then Confirm & Publish through the Reply workflow.
7. Review Analysis enrollment is exhaustive for the authorized eligible source population; internal batching controls work size but never becomes a product cap or silently drops older Reviews.
8. Missing, stale, or unreadable data returns `preparing`/unavailable evidence rather than zero. Coverage-incomplete Property insight aggregates may expose exact applied results only with an explicit provisional marker and coverage counts; period comparisons remain absent until both windows are complete.
9. No source content or credential is stored in Redis, queues, events, telemetry, operation identifiers, or subject references. Durable facts are identifier-only and protected subjects use audience-separated HMAC references.
10. Provider work is cell-local and permit-bound. A provider outage, denied route, quota ambiguity, Redis/control outage, or authorization uncertainty fails closed without direct-network fallback.
11. The enrollment safety ceiling is a pause, not a population limit. No replay becomes actionable until the governed operator command records exact-fence, ticket-digest, operator, and correlation evidence. That command cannot change consent, select a subset, start work, or activate provider execution.
12. Raw provider requests/responses, prompts, private data, tokens, and unredacted errors are prohibited from database, Redis, job payload, log, and evidence artifacts.

## Verification

Unit tests stay beside admission, lineage, lifecycle, enrollment, trend, drafting,
worker, server, and public-boundary subjects. PostgreSQL integration tests cover
transactional fences, replay, erasure, lifecycle, and export behavior, and which
Properties the Property Trend scheduler picks and whose outcome it still accepts
(`ai-property-trend-schedule-store.adapter.integration.test.ts`).

The context contains substantial control, admission, lifecycle, analysis, drafting, aggregate, and schedule infrastructure. That does not mean every beta capability is release-ready. The comprehensive program status ledger is the completion authority; live provider/cell drills, full product-facing enrollment progress, and deployed lifecycle/recovery evidence remain required until their packages are evidence-complete.

The unconditional recurring enrollment sweep is registered, catalogued, and scheduled through the shared operational authority; deployed scheduler/runtime observation remains release evidence rather than a local-code claim. A broader manager-facing analyzed/candidate/excluded/failed and Verified Through surface remains a product gap. Deployed scheduler/runtime observations remain release evidence, not a local-code claim. Reply Draft cross-context deletion proof, provider-side deletion evidence where applicable, and deployed recovery evidence remain release gates.

The first-enablement Review Analysis enrollment replay and the sweep's reopen pass are the only producers of `ai.review_analysis.backfill_requested`; a reopened review's event is correlated to the operation it replaces, never to an enrollment. Migration 0157 adds the fixed whole-snapshot safety pause, assisted-approval evidence, readiness counts, and `ops:ai-approve-enrollment`; a broader manager-facing analyzed/candidate/excluded/failed and Verified Through surface remains a product gap.
