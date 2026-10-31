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

Merchant authorization follows the acknowledged notice, independently of the
runtime/deployment recorded as historical evidence (ADR 0074). The shared pure
`isExecutionCompatibleWithConsent` requires an in-force version/digest and an
explicit catalogue entry for the capability and served execution triple. Unknown
pairs fail closed. Operations and execution controls use the served selection;
the gateway still requires the exact served operation/runtime/deployment.
New provider work and settlement use this compatibility rule while retaining
lineage, state, membership, source, epoch and control-generation fences. Reads
and delivery of already-produced outputs, draft adoption/publication and trend
scheduling retain their previous rules, including stored analysis under an
unchanged grant whose notice has lapsed.

Today only the 2026-10-30 notice is in force. Its introduction materially changed
all three capabilities, so earlier consent requires renewal. An out-of-force
notice answers `consent_renewal_required` for drafting, after tenant/access
checks and before claiming work, with the notice fix target. Re-consent advances
only capabilities whose membership/source scope changed or whose notice data
use materially changed across intervening versions. Source policy, routing policy
and redaction family changes still advance every previously or newly enabled
capability epoch. A drafting-only material
notice preserves Review Analysis and trends epochs and the analysis frontier.
A technical runtime/deployment refresh writes no consent evidence or epoch.

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

## Review analysis switch-on (2026-10-30)

Review analysis v3 is the analysis the product runs. The catalogue selects the operation
profile `review-analysis-v3` (`ai-operation-profiles.ts`) on OpenAI `gpt-6-luna` at low
reasoning, pinned by its plain id because the account lists no dated snapshot
(`ai-openai-request-contract.ts`; the quality check of 2026-10-30 is the evidence, ADR 0031).
The price list is `ai-openai-provider-profile.ts` ($0.10 input, $0.01 cached input, $0.50
output per million tokens, from third-party lists of 2026-10-30; OpenAI's pricing page is the
authority). The deployment profile is `private-beta-global-v2` (`ai-provider-deployment-profile.ts`:
the envelope names OpenAI and Anthropic; the provider every capability runs on is OpenAI), the
runtime profile `review-analysis-runtime-v2`, and the served notice
`merchant-ai-notice-2026-10-30.v1`, the only one in force. The v2 profile stays in the
catalogue as retired so that pending and historical v2 operations can still be read and
settled; no new work is claimed on it. Reply drafting and property trends run on the same
deployment profile, so they run on `gpt-6-luna` too.

The provider choice is `OPERATOR_PROVIDER_SELECTION` (`ai-provider-control/operator-provider-selection.ts`),
a constant and not an environment value, and it names OpenAI alone. `createOperatorProviderChoice`
(`ai-provider-choice.adapter.ts`) is the port the build wires; the egress runtime registers
no Anthropic adapter. Moving to Anthropic needs a registered adapter, a key, a provider
control head (migration 0083 seeded `provider:private-beta-global-v2` only), a change of the
constant and the owner's date from the Privacy Notice (docs/BETA.md section 2). It needs no
new deployment profile and no new consent.

Consent: a consent recorded under any earlier notice is refused before work is claimed, and
re-consent moves the notice; its declared material changes advance the affected capability epochs
(`apply_merchant_ai_transition_v1`). The review analysis epoch bump makes the enrollment
replay analyse the history again, and `eraseRetiredDerivatives` deletes the retired epoch's
derivatives. Turning AI off, revoking or erasing also deletes the per-Property issue groups and
the daily star counts (`eraseReviewAnalysisV3Remainder`;
`ai-review-analysis-v3-turn-off.integration.test.ts`). Operating it, killing it and the limits of a
rollback are `docs/operations/runbooks.md` section 32.

What reads analysis data, after the switch-on: Guest voice reads one thing, the v3 read, and
says "AI analysis is off" or "being prepared" where there is no page (a consent recorded under a
notice no longer in force reads as off, because nothing is being prepared
for it until an AccountAdmin confirms the served one); a live quote is shown
only when the review's current source revision equals the analysed revision; the Overview row
reads the same v3 read; a manager-typed cause passes the same name and four-word guards as an
AI cause (`managerCauseRefusal`); the Inbox reads mentions, and an old `?aspect=` link finds
nothing without an error because a v3 analysis has no aspects; the Priority suggestion is the
v3 attention; reply drafting reads no analysis topics; Settings offer the Guest voice summary
and the Urgent reviews wording while `REVIEW_ANALYSIS_V3_LIVE` holds, a constant a test pins to
the runtime catalogue. The pages and server functions that read the v2 aspect aggregates
(`property-insights.ts`, `property-aggregates.ts`, `property-trend.ts`) are no longer called by
any route; they are kept for the cleanup that removes the aspect read model.

## Review analysis v3 contracts

The shape of a v3 analysis lives in `src/shared` (`review-analysis-v3.test.ts` fails if a
profile or the catalogue does not select it as above). It replaces the
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
place word (a capitalised word of the review, wherever it stands, the first word of a
sentence and a heading included, that is neither a common word, nor one of the request's
vocabulary hints, nor also written in lowercase in the review), that repeats four or more
contiguous words of the review, or whose shape is not one to three lowercase words of letters and
hyphens (a digit, a comma, an apostrophe, a fourth word, a thing with no issue) is refused and its
mention stays as a topic-level mention (`cause_refused_name`, `cause_refused_quotation`,
`cause_refused_shape`; migration 0082 added the last to the check on a settled operation's flags).
Mentions that repeat a topic, thing and polarity merge; the merged mention keeps the lowest 16
sentence numbers and reports `sentence_refs_capped`, so a merge can never fail a paid answer.
The guard reads capitals, so a name the guest writes entirely in lowercase passes it; the
request's prompt, which forbids names, brands and places in a cause, is the other line. Attention v2
(`deriveReviewAttentionV2`) is derived from the stored answer and the star rating; Urgent
exists only when the provider reports one of its four reasons. `aspect-taxonomy-v1` and
every v2 schema stay as they are for history.

Storage for it (migration 0078, `ai-review-analysis-v3.schema.ts`) is written by the analysis flow
below, which the runtime catalogue has selected since the switch-on (2026-10-30):
`ai_review_analysis_mentions` and `ai_review_analysis_mention_sentences` for the analysis,
`ai_property_aggregate_contribution_mentions` for the same mentions under the contribution
that retracts with them, `ai_property_review_population_daily` for the reviews of a local
day by stars (star-only reviews included; nothing writes it yet, see "Not built" below),
`ai_review_analyses.urgent_reason`, and lineage
columns on `ai_operations` (provider, model, request profile, vocabulary hint set,
normalizer, and once settled the closed flags it raised). `ai_review_analyses_result_valid`
tells the two shapes apart by `analysis_profile_version`: a v3 row has no primary category
and no issue label, and carries an Urgent reason exactly when its attention is urgent. A
CHECK passes on an unknown, so each v3 arm states IS NOT NULL beside a comparison. The
execution-control scopes also admit `provider` (`provider:openai`, `provider:anthropic`), but
nothing reads or seeds them yet (see "Left for the slices that need it" below).
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

### Evidence request path

A v3 request carries the review as numbered sentences (`review-analysis-v3-request.ts`,
`ai-provider-control/review-evidence-request.ts`). Review cuts the RAW text with
`review-sentences-v1` and canonicalizes each sentence (`readForAi` with `sentences: true`),
so sentence `n` is the sentence the live display underlines for a stored pointer `n`; the
request's `source.text` stays the whole canonical text, so the operation's source digest is
the one v2 computes and the gateway checks that the sentences are that text, cut and
numbered from one (`reviewSentencesMatchText`). Only a binding that names
`review-analysis-v3` may carry sentences and a `propertyContext`. Since the switch-on
the live catalogue serves that binding for review analysis, so the transport accepts it
and refuses the v2 form as cross-wired (the retired form); a v2 request that carries
either is refused too. The property context must be what
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
profiles as a dependency (the live catalogue by default), which is how a path is
exercised without a live entry. The in-process adapter gives a v3 request a bound of
98,304 bytes (v2 keeps 65,536): 512 sentences of 30 characters, all needing a JSON escape,
are the largest request the Review limits allow and fit under it.

### Provider seam

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
(`createAiEgressRuntime({ providerSelection })`; the switch-on kept it a constant,
`OPERATOR_PROVIDER_SELECTION`, with no environment variable). A profile attested for one provider is served by it and ignores the
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
and is how the v3 profile (`review-analysis-v3-profile.ts`, with its prompt from the
annotation guide) became a catalogue entry at the switch-on. `defineProviderDeploymentEnvelope`
names every provider of a deployment by attestation digest (`private-beta-global-v2` is built
from both since the switch-on); choosing one of them is not an
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
synthetic canary (3.10); `openai-usage.ts` resolving the input ceiling of a profile that is not in
the live catalogue.

One item of that list must be done before the first Anthropic call, because until then an
operator cannot kill, drain or cap one provider alone, only the whole envelope or the capability:
the `provider` execution-control head. Migration 0078 admits the scopes `provider:openai` and
`provider:anthropic`, but the control port knows the global, deployment-profile and capability
heads only: `resolveAiExecutionStopFence` and the budget admission check read the
deployment-profile head (`provider:<deployment profile version>`), the fence holds exactly three
heads, and no head is seeded for a concrete provider. It needs the binding schema in
`ai-internal-transport-contract.ts` (at its file-length ceiling, to be split first), the stop
fence, the claim and the admission check wired to it, a seeded head per provider (migration 0084
or later, since 0078 to 0083 are taken) and a test that kills provider A while B stays eligible.
Nothing can run on Anthropic until it is selected, so nothing is exposed today.

### Analysing, storing and aggregating v3

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
runtime catalogue names `review-analysis-v3` for `review_analysis`; since the switch-on
(2026-10-30) the catalogue holds v3 alone and its parser refuses anything else, so every build
runs v3 and the v2 contract is the retired form, kept so an operation claimed before the deploy
can still be read and settled.

What the v3 contract (`review-analysis-contract-v3.ts`) does that v2 does not:

- Before the claim it reads the Property's Google primary category through
  `PropertyVocabularyContextPort`, resolves the vocabulary hints, and asks `AiProviderChoicePort`
  which provider the operator has chosen. A category the hint resolver refuses, a review whose
  sentences the source cannot give, or no provider are refusals the review waits out within its
  horizon (`property_context_invalid`, `sentences_unavailable`, `provider_unavailable`,
  `provider_selection_required`), never a verdict on the review. Since the switch-on the port is
  wired: `build.ts` hands the use case `createOperatorProviderChoice()`, which answers
  `OPERATOR_PROVIDER_SELECTION` (OpenAI alone).
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

Immediately after that copy, under the aggregate transaction's first-statement Property advisory
lock, every mention is assigned to a stable Property issue group (migration 0079). Assignment
uses a stored member, then an existing canonical group, then creates a group; the statements are
set-based for the analysis. Its deadline only moves forward to the latest analysis expiry ever
assigned to it.

A current-analysis read answers `{ status: 'ready_v3', topics, urgent reason, ... }` for a v3
row: topics, polarity, strength, the optional cause and the names flag, never a quote or a
sentence. The Inbox reads it: `composition/inbox-ai-insights.ts` turns it into the Inbox's own
`ready_v3` (the numbers of the cited sentences, the Property issue each mention belongs to now, a
manager's correction beside it), which the pane draws as cause chips and underlines in the guest's
own words (`src/contexts/inbox/CONTEXT.md`).

Not built: the `ai_property_review_population_daily` projection. Nothing writes the table; the
turn-off, revoke and erasure paths and the 24-month sweep delete from it. It would follow a
review's observation, update and deletion whether or not the review is analysed, so the analysis
flow does not write it, and it needs a backfill of at least the earlier 12 months of reviews
before any percentage or "worth up to" figure reads it. Guest voice does not read it: it counts
from the live review population (`readTrendPopulation`), so no figure on a page is wrong for want
of it. The merchant notice of 2026-10-30 and Privacy Notice 3.0 nevertheless say that daily
counts of reviews by star rating are kept for 24 months, which holds only once this projector
exists. Also left: including v3 derivatives in an organization export. The statistics that read
the mentions (the Guest voice read model) and the wiring of `AiProviderChoicePort`, the runtime
catalogue row and the served-contract constants (`isCurrentAuthorizedEffect`, the deployment
profile string) shipped with PR-4 and the switch-on (2026-10-30). Property issue grouping itself
is complete below; publishing its manager commands and reads remains PR-4 work.

### Property issue groups

`ai_property_issue_groups` is one stable random UUID for a normalized `thing` under one Property
and topic. `ai_property_issue_members` remembers observed normalized spellings. Resolution is
deterministic and Property-local: stored member, canonical key, then insert. A topic-level mention
uses `__topic__`. The governed `property-issue-normalization-v1` catalogue (rules v2) singularizes
the last word of a phrase (the explicit forms it lists first, then one rule: `ies` after a
consonant to `y`, `es` dropped after `ss`, `ch`, `sh` and `x`, any other final `s` dropped; a word
of three letters or fewer, a word ending `ss`, `us` or `is`, and the words it keeps as written,
such as `stairs` and `news`, stay) and applies exact topic-scoped synonyms (`server` to `waiter`,
`outboard motor` to `engine`, `front desk clerk` to `front desk`). The evaluation scorer passes
the gold and the answer through the same function. A reviewed edit moves its digest but does not
regroup history because stored members win. No model clusters, proposes or learns a group across
Properties.

An ID survives re-analysis, epochs and new spellings. Merge preserves the target and leaves the
source as a redirect; redirects into the source are flattened to the target in the same
transaction, so resolution is one hop. Cross-topic merge is refused by the application and by
composite database foreign keys: a read-model issue has exactly one topic, and the contract
permits only same-topic merge proposals. Assignment, rename, hide, show, merge and resolve carry
Organization and Property predicates. Mutations take the aggregate writer's Property advisory
lock before locking changed groups `FOR UPDATE`; `resolve` is a read that takes no lock, so
showing an issue never waits for an analysis to be stored.

`expires_at` is the greatest expiry of any analysis assigned to the group and never moves back.
Rename, hide and merge do not extend it; merge only raises the target to the greater of target and
source. The sweep runs `ai_review_analyses.v3_expired` first, then deletes an expired group only
when no contribution mention references it; members and redirects cascade. Organization
lifecycle removes contribution mentions before members and groups. A contribution mention's
foreign key to its group is deferred to commit, because erasing a Property deletes groups and
mentions along different cascade paths and an immediate check refused the erasure.

The manager command factory is deliberately unwired. PR-4 must publish it behind its chosen
permission, add the Guest voice read model and drawer, record the manager audit event, and map an
Inbox mention to its surviving issue. `display_name` is manager text: it is a protected local fact
and may reach none of provider input, logs or events.

### Evaluation harness (dark)

`pnpm eval:review-analysis-v3` (`scripts/evaluation/`) measures a provider against the synthetic
test set in `test-fixtures/review-analysis-v3/` (424 invented reviews, 419 with a settled gold
label in `gold-v1.1.jsonl`; the owner still settles `cl-0021`, `cl-0054`, `cl-0163`, `cl-0174` and
`cl-0188`, which no score includes). 24 of the reviews are Bulgarian and Spanish Urgent and near-miss
items, so Urgent recall can be read in all three languages (44 Urgent cases: 30 English, 7 each). It asks the production question: each review goes through the Review context's
source canonicalizer and sentence splitter, the deterministic redactor, the production prompt, answer
schema and request payload (the Property's vocabulary hints chosen from the review's business), and
the one place a provider answer becomes the stored contract (`acceptReviewAnalysisV3Answer`).
Only the transport differs. An answer the production path would not accept, a refusal, a
truncation, a failed call and a review the redactor refuses are scored as an empty answer: for
Urgent that is a review whose danger nobody saw.

The reference is the gold as the production normalizer accepts it, so a label the stored contract
cannot hold (an `issue` such as "30 minutes") does not count against a provider; the report names
the labels that changed (none in gold v1.1, which words the three that changed in v1 so the contract
holds them). The loader refuses a gold label whose `thing` is a generic word (annotation guide v3.3,
rule 3: place, staff, team, welcome, price, location...; `src/shared/review-generic-things.ts`, the
list the prompt gives the model). The report also names the reviews the redactor
changed (`cl-0041`, `cl-0138`, `cl-0184`: it reads "oil.For" and "working.Not", a missing space
after a full stop, as web addresses) and any review the live path would not send. Causes are
compared through `property-issue-normalization-v1`, so "ac" agrees with "air conditioning".

The gates are decision 6 of the contract decisions (`docs/plan/guest-voice-2.md`), as gates v2
(`review-analysis-gates-v2`) read them after the first OpenAI measurement, for the whole set and
for English, Bulgarian and Spanish: Urgent with zero safety or health misses, at least 95% recall
and at most 2% of non-urgent reviews flagged; topic micro F1 at least 0.85 and no topic below 0.70
in a slice that holds at least 10 gold reviews of it (a smaller topic is scored and named in the
gate's note, not held to the floor); thing agreement at least 0.60, after the same normalisation of
the gold and the answer (the two labelling families agree with each other at 0.59 by this metric).
The reasons are in ADR 0031, amendment of 2026-10-30, part (b), and in the header of
`review-analysis-v3-gates.ts`. A gate over nothing is "not measurable", never a pass; a provider
passes only if no measured gate fails and every gate over the whole set could be read. Sentiment, polarity, strength, evidence sentences,
the names flag (with the count of named people the answer missed), robustness, run-to-run
disagreement and the context slices (other languages, business family, length, sarcasm, rating
conflicts, near misses) are reported, not gated.

The providers the command can name are `fake-gold` (answers with the gold: the ceiling and a
smoke test), `answers:<file>` (scores answers recorded by any governed tool) and `openai` and
`anthropic`, which are declared and refuse to run. The tests and the package script reach no
provider: nothing in `scripts/evaluation` imports an HTTP client or an SDK or reads a key, and a
test pins that. Reports (`report.json`, `report.html`, one labels file per provider and run) go to
`test-results/review-analysis-v3/`; they hold counts, rates, topic ids and review ids, never a
review's text or a provider's raw answer.

Left for the slices that need it: the evaluation transport for the real providers with their own
evaluation keys and the dated model snapshots (decision 4), and the live slice's evaluation table
(ADR 0031, amended 2026-10-30). The first quality check against OpenAI ran outside this command: a
bundle of the harness's own preparation, prompt, schema and normalizer ran inside the beta worker
with synthetic items and wrote nothing; its answers were scored here with `answers:<file>`.

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
first, sixteen analyses at a time, and records an enrollment caught up as soon as
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

Guest voice 2.0 (`readGuestVoiceV2`, v3 contract section 9) is the Guest voice page, and since the
switch-on (2026-10-30) the only one: the route reads it once. A Property whose reviews have a v3
analysis gets the page; any other gets a reason instead (`hasV3Analyses`: a ready v3 contribution
under the Property's current epochs): "being prepared", or "AI analysis is off" when AI is off or
the consent was recorded under a notice no longer in force. Its types are
`application/read-models/guest-voice-v2.ts`, content-free except `LiveEvidence`. The read joins two
answers (`read-models/guest-voice-v2-join.ts`). Review says which reviews the Property has now
(`readTrendPopulation`, as the insights read: two years in one read, the last year alone and no
change claimed when that is too full, 90 days when the year is). The analysis side
(`AiGuestVoiceFactsPort`, `infrastructure/adapters/ai-guest-voice-facts.adapter.ts`) gives each
review's latest ready v3 contribution and its effective mentions in one statement under the
aggregate head's share lock, with the Property's issues. A review is counted only where both agree
on its revision, analysis sequence and day, so an analysis of a review that has since gone or
changed is never counted; a review with text that has no analysis yet makes the figures
`provisional`, which also withdraws any claim of change. Issue impact figures are `issueStatistics`'
(`read-models/issue-statistics.ts`), the PR-1 engine's: an issue is one thing under one topic
(`ai_property_issue_groups`), counted in reviews, not mentions; three complaint reviews enter Fix
first, ranked Urgent first, then by stars at stake; one or two are Watch; praise is Guests love;
What changed has only moves the engine calls likely, bad news first; a topic with no issue of its
own is the topic-level issue. A manager's hiding keeps an issue out of every ranking and out of
nothing else (Every topic still counts it, the Inbox still shows it), and never hides an Urgent
review. "In short" is three fixed sentence patterns over those lists.

The guests' words are the one thing the read does not hold. It is a draft (`GuestVoiceV2Draft`):
every figure is final, and for each card it names which reviews could be quoted and the sentence
numbers their mention cites (`EvidenceSlot`, at most three, strongest then most recent). A review
that names a person (any mention's `names_person`) is never offered: a quote shows the whole review,
so a name flagged anywhere in it would be on the page (decision 2 wrote "any mention citing that
sentence"; this is the stricter reading). The flag is read from the answer as the provider gave it
(`GuestVoiceReview.namesAPerson`, an `EXISTS` over the stored mentions), not from the mentions left
after a manager's corrections: removing the mention that carried a name takes a topic out of the
counts, not the name out of the text, so the review stays unquotable. The delivery layer (`server/guest-voice-evidence.server.ts`) then reads,
under the reader's own access, which Inbox Item opens each review and what the review says now
(`resolveDraftReviews`), and `withLiveEvidence` cuts that text with `review-sentences-v1`, the rule
the analysis used. A review the reader cannot open, whose text has gone, or that now has fewer
sentences than the analysis numbered is not quoted, and the card keeps its figures. Review's
eligible snippet carries the revision of the words it serves, and a candidate is quoted only
when that equals the revision the analysis was made on (contract 6.2 step 2); a young
Property's latest-review row shows words only at the revision it was counted and checked for
names at. The population read already pins every counted review to Review's current revision,
so this closes the gap before the text read, in which an edit could have underlined the wrong
sentences. Nothing is stored. A Property with under about 10 reviews with text in 12 months gets `not_enough_reviews`
and its latest reviews, with words only where the analysis is in and names nobody.

The weekly check-in read (`guest-voice-check-in-v1`, within the existing v2 read
family) adds serious concerns, comment-rating comparison, per-issue recency,
exact section totals/overflow and all twelve topic assessments. The intended page
order is concerns → happier → fix → praise → collapsed topics. Legacy `urgent`,
`inShort`, `whatChanged` and capped rankings remain for Overview/Monday consumers.
One shared grouping pass assigns each urgent review to its primary surviving
negative issue and reason, else a fixed reason-only group. Safety-topic complaints
win, then strength, then ordinal. Hidden issues stay in concerns. Group counts
are distinct from report counts, recency/counts use urgent members only, and
coverage is complete/provisional. Small states use the same selected-window path
before returning: the year decides eligibility, while selected-window basis,
concerns and up to three previews describe exactly the selected days. Failed
facts reads are preparing, never quiet zeroes.

`guest-voice-rating-trend-v1` reads current servable comments from the chosen
Review population, including unanalysed comments and excluding star-only ones.
The fixed recent split is min(90, max(7, floor(inclusive days / 4))); before is
the remainder. At least 20 before and 10 recent comments and complete analysis
are needed for a verdict. The existing independent Beta(1,1) happy-share
comparison uses a .05 margin and central 95% threshold, and requires an
unrounded mean change of at least .20 stars in the same direction. Steady is
not equivalence. Monthly means weight raw rating counts, retain empty months
and partial calendar bounds, and may span thirteen months. These are comment
ratings, not Google's rating; dataThrough is the calendar cut-off, not sync time.
Topic status needs six unique mentioning reviews and uses happy share of all
mentions (including mixed/neutral), at .45/.65/.80 cut-offs. The four per-review
categories are disjoint. Hidden groups remain in topic evidence. Transient
titles use a manager's nonempty rename verbatim, else thing/topic plus top
normalized cause; automatic collisions receive topic/id context. Answer and
clipboard copy belongs to pure UI functions; summaries use fixed topics and
unique topic counts, never titles or causes.

`readGuestVoiceDetail` and `getGuestVoiceDetailFn` now provide live issue,
concern and topic reads. `guest-voice-read-context.ts` shares Property admission,
AI/served-contract gates, local calendar, bounded population reads and current
revision/sequence/day joins with the page. Details accept Property/range/current
ISO bounds/target; stale bounds return `refresh_required`, unknown targets
`not_found`. Disabled/preparing reads never fabricate a ready sheet. Issue bars
compare current analysed comments with their set difference, separate from
all-review impact statistics. Linked concerns indicate shared review ids only.
History is twelve calendar months when covered; bounded fallback is window-only.
`guest-voice-evidence.server.ts` shares reader-authorized live resolution; drafts
contain references only, and evidence keeps sentence ranges (clause underlining
is deferred). A reason-only concern with no surviving cited negative issue may
have no safe quote. Issue rename/hide/merge commands remain unpublished.
Existing issue/polarity/day and urgent Inbox searches are retained; there are
no new topic/concern identifier filters or All reviews queue in this change.

The page names the Property's Google rating goal beside the top problem, and AI knows nothing
of it: the route reads the goal card (`ratingGoalCardQuery`, the Reporting context's read) and
passes the active goal's facts to the page (`guestVoiceGoalOf` in
`routes/_authenticated/properties/$propertyId/-guest-voice-v2.ts`). A Property with no active
goal, or a reader who cannot read it, draws no line, and a failed read is never an error on the
page. The line says where the goal stands in the goal's own words and, when Fix first has a top
problem, what it could be worth (`upTo` of its statistics, on the page's own window); it links to
the goal's page and never promises that fixing the problem reaches the goal.

An Urgent analysis raises the one alert an AI finding may start (v3 contract decision 10;
ADR 0031 and ADR 0046, amended 2026-10-30). `storeAnalysisV3` writes it in the transaction
that stores the analysis (`infrastructure/adapters/ai-urgent-alert.ts`): one identifier-only
fact, `ai.review_analysis.urgent_detected`, naming the Organization, Property, review, source
epoch, source revision and the analysis, and nothing of why (the reason stays in
`ai_review_analyses.urgent_reason` and is read in the app; a payload field called `reason`
would be stripped as content). It is one fact per review REVISION: the fact's id is derived
from the revision and an existing fact is not written again, and an earlier ready analysis of
the same revision that was already Urgent means it was raised even if its fact has left the
outbox (a re-consent's new epoch, a reopen and the replay of history all analyse a revision
again). A new revision of the review is a new alert. Feed owns the rest (its CONTEXT.md): the
recipients, the words, the silence for old or handled reviews, and the delivery. Nothing here
changes the review: no status, assignment, escalation or priority.

The Monday email (v3 contract decision 11; ADR 0046, amended 2026-10-30) is decided here and
mailed by Feed. An hourly sweep (`ai-guest-voice-summary-sweep`, `runGuestVoiceSummarySweep`,
tenant-cross, each Property decided under the schedule's own action) lists the Properties with
Review Analysis enabled whose own clock reads Monday 08:00 to 10:59 (`isSummaryMorning`, in
the runtime and not in SQL, so a timezone it does not know drops one Property and not the
sweep), asks `planGuestVoiceSummary` and records one governed fact,
`ai.guest_voice_summary.ready`, for each that has something to say (id derived from the
Property and the day, so the later runs of the morning write nothing). The plan is the Guest
voice read worked out for today and for a week ago over one read of the analysis: a week is
quiet when Fix first held its order and members, no issue is new to Fix first or Watch and no
review was Urgent in the last seven days (`isQuietWeek`), and a quiet week sends nothing; the
first Monday of the month (`isFirstMondayOfMonth`) sends the roundup whatever the week held. A
Property with no v3 analysis, or too few reviews with text to show patterns, sends nothing,
and one too full to read a year before its window has no last week to compare with and is
never called quiet. The fact is the page's three "In short" lines as topic, counts, the stars a
problem may be worth, which way a change went and the issue's id (`summaryLines`); no issue
name, cause, quote or review is in it. Known limit, deferred past the switch-on: one sweep looks
at the first 500 due Properties by id (`GUEST_VOICE_SUMMARY_SWEEP_LIMIT`), and the two catch-up
runs of the morning take the same 500, so above that many Properties due at once the later ones
are never reached; a keyset page over the due set (consent filtered before the paging) fixes it.
The trigger is 250 Properties enabled for the summary, half the limit; the beta has two
Organizations, so nobody is missed today.

A manager corrects what the AI said of a review in the Inbox ("Not right?", `correctReviewMention`,
migration 0080, decision Q11), and the correction takes effect at once. The kept answer is never
changed: a correction is one row beside a mention (`ai_review_analysis_mention_corrections`, at most
one per mention) that every read lays over the answer before it counts anything
(`ai-guest-voice-facts.adapter.ts`, the Inbox's current-analysis read, the Inbox's issue filter).
Three kinds. `remove_topic` sets aside every mention of that topic in the analysis, written and
given back together. `not_a_problem` is for a complaint and counts as neutral. `change_cause`
gives the thing and what was wrong as one or two short lowercase phrases (the stored contract's
own: `normalizeCausePhrase`; a thing needs its issue) and moves the mention to the issue of that
thing, found or made as an analysis's mentions are (`resolveIssueGroupForThing`, under the
Property lock, keeping the issue at least as long as the analysis). A correction is written only
for the review's current ready v3 analysis under the authorization's fences, so a review that has
changed since the Inbox read it answers not found; a new revision is a new analysis, starts with
none, and leaves the old correction beside the old answer, where it is no longer effective. An
undo deletes the row. The row holds a kind, two phrases a manager chose and the manager's id, never
a quote or a name; it goes with its analysis at 24 months (cascade from the mention) and with the
issue it moved to. Nothing is learned from it: it changes no prompt, hint or catalogue, and the
correction rate per topic (corrections over the topic's mentions) is a count over this table.

The server function names the reading the manager saw (`analysisSequence`): a mention number only
means something inside the analysis it came from, so a call that names another sequence than the
review's current one answers not found, writing nothing, even before the use case runs. The Inbox
asks through a plain function fetched with its first use (`routes/_authenticated/-inbox-fns.ts`),
so the stub stays out of the first-paint closure.

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
head has moved past is stale, not retried. The Trend scheduler, the Trend store
and the Trend report read take coverage from the head's count too, as the Trend
run does, never from the ledger: a rolled generation is not scheduled and does
not read caught up until it is rebuilt. Two kinds of data written before
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

## Reply drafting v2 contract — registered dark (B1, 2026-10-31)

The served drafting selection remains `reply-drafting-runtime-v1` / `reply-suggestion-v1`.
The notice, UI, historical profile readers and v1 wire pins are unchanged. The registered
v2 catalogue row still has `served: false`. B2 registers its streaming execution as
compatible with the notice already in force (ADR 0074); only a later serving selection
can admit it through the gateway. No new notice or consent write accompanies B2.

The new identities are operation `reply-suggestion-v2`, profile `reply-draft-v4`, runtime
`reply-drafting-runtime-v2`, prompt `reply-suggestion-prompt-v2` and provenance v4.
The Phase 0 final prompt and synthetic English/Bulgarian example books are versioned and
pinned. Numbered source uses Review's existing raw-text sentence identities and the
joined-scan, sentence-preserving redactor. The provider receives only rating, tone, target
language, bounded length/opening/apology options, numbered redacted sentences and profile
identity. Those options, the resolved language and voice configuration are execution-bound
and fingerprinted. Dynamic examples/rewrite instructions have a separately reserved byte
ceiling. V2 uses medium effort and 2,048 output tokens; v1 retains its own settings.

Sentence references validate reference integrity, not factual truth. The existing
commitment/leakage authorities remain, with Spanish stems added only to the new contract.
AI-body lint has fixed codes/severity/digest; hard findings contain no matched terms.
The operation writer and database CHECK admit only closed metadata keys, fixed apology
starts and hard rule codes; avoidance terms cannot be stored in rewrite metadata.
An invalid billed draft ends its operation. At most one rewrite child is independently
claimed, admitted, permitted, reserved and settled. A locked failed/settled root and the
unique parent index prevent duplicate children and grandchildren. Its instructions contain
fixed rule descriptions, never rejected text or avoidance terms. Provider refusals,
transport ambiguity and unavailable scanners do not cause a rewrite. The child re-reads
source, reply revision, consent and voice, and v2 checks them again after settlement before
delivery. Only accepted text is framed, signed and delivered; unadopted text stays ephemeral.

Frame usage is scoped by Property, language, rating band and configuration digest. The
Review-owned reservation ledger holds option identities only: recent reservations rotate
concurrent/unpublished regenerations; adopted usage survives subsequent text edits.
Published template usage is aggregated under that exact scope at publication time.
When v2 is served, template generation records the frame band in content-free voice choices, so later
source edits cannot reclassify an option. Historical choices without a recorded band stay
unknown and are not assigned a guessed band. A thanking body excludes thanking closings,
with omission when none remain. The signed v4
choices survive adoption. Choice changes do not change the voice configuration digest.
Unadopted reservations expire from eligibility after fifteen minutes and are pruned on the
next generation; Property deletion cascades the ledger. It contains no source/manager
text and is not manager-authored export content. Migration 0085 appends the runtime,
provenance, rewrite uniqueness and reservation schema without rewriting historical grants.

Re-verified map items 1–6 on the supplied stacked base `af57b9c36` (current implementation anchors):

| Map item                                   | Authority                                                                                                                                                                                                      |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — profile/prompt/schema/provenance       | `src/shared/reply-drafting-v2-profile.ts:22`, `src/shared/reply-drafting-v2-schema.ts:24`, `src/shared/ai-reply-provenance.ts:151`                                                                             |
| 2 — numbered input/options/binding         | `src/shared/reply-drafting-v2-request.ts:152`, `src/contexts/ai/application/reply-drafting-v2-workflow.ts:72`, `src/shared/ai-provider-control/reply-drafting-v2.ts:248`                                       |
| 3 — effort/output/reservation bounds       | `src/shared/reply-drafting-v2-profile.ts:22`, `src/shared/db/ai/ai-budget.ts:96`                                                                                                                               |
| 4 — lint/one independently charged rewrite | `src/shared/reply-drafting-v2-contract.ts:89`, `src/contexts/ai/application/reply-drafting-v2-workflow.ts:44`, `src/contexts/ai/infrastructure/adapters/reply-rewrite-parent.ts:16`                            |
| 5 — Spanish/historical readers/schema      | `src/shared/reply-drafting-v2-contract.ts:89`, `src/shared/ai-reply-provenance.ts:151`, `src/shared/db/schema/reply-ai-provenance-check.ts:4`, `drizzle/0085_reply_drafting_v2_contract.sql:1`                 |
| 6 — frame choice/usage/adoption            | `src/contexts/review/application/ai-reply-v2-frame.ts:21`, `src/contexts/review/infrastructure/repositories/ai-frame-reservation.ts:156`, `src/contexts/review/infrastructure/ai-suggested-draft-store.ts:481` |

## Reply drafting progress and background intent — dark (B2, 2026-10-31)

The authenticated `generateReplySuggestionStreamFn` POST returns a raw streamed
`Response` with NDJSON and private/no-store headers. Installed Start server core
1.169.39 returns a Response body directly with `x-tss-raw`; client core 1.170.34
returns that raw Response without JSON buffering. This avoids another API/auth
boundary. The existing lazily loaded server module imports the new transport so
Start discovers its endpoint; the production build manifest confirms it. The
composer still calls the original server function and has no new UI.

Only v2 sends `stream: true`. Its separate OpenAI request/transport attestation and
`private-beta-global-v3` deployment are compatible technical refreshes under the
unchanged notice. Migration 0086 seeds that deployment's control head only. The
switch-on PR widens the consent-evidence and enablement deployment CHECKs; no
grant is rewritten. Every v1 wire/deployment pin remains unchanged. SSE is bounded
at 1 MiB including ignored events, validated
as UTF-8 across chunk boundaries, and the accumulated JSON text at 16 KiB. The
larger response envelope accounts for SSE event overhead. Terminal usage is
validated through the original usage authority and settled once, including when
output is refused, malformed, truncated, or a browser disconnects. Trailing bad
frames invalidate delivery without discarding terminal usage already received.

Progress is metadata only: admitted/source-read `reading`, dispatched `thinking`,
complete schema-valid/source-valid `answering` sentence numbers, first reply
characters `writing`, validator/lint `checking`, and admitted child `rewording`
ordinal. The ordered JSON-prefix scanner never repairs partial JSON or emits
strings. Unavailable/out-of-order metadata stages are skipped. The final strict
parse, body/language/Google checks, local framing, settlement, freshness and signed
provenance use the existing acceptance path. Its accepted result or the unchanged
governed local template fallback enters `done`; explicit failures use controlled
`refused` reasons. Sequence numbers and
step ordering are browser-stream local, with one bounded rewrite cycle.

`intent: background` uses only background admission, never waits for capacity and
returns `deferred` quietly on the stream when no result is available. Atomic
sliding-minute draft caps of 6 per actor and 30 per Organization protect the
shared analysis lane; a denial consumes no lane capacity or provider call. Explicit
requests retain their interactive lane and actionable refusal codes. An explicit
join of background work that defers before admission starts one deduplicated
interactive successor under the same key; an already admitted generation is joined
without another provider call. Background
eligibility reads current local and Google-observed reply truth, eligible current
source, notice/capability, language, profile and voice. Reply truth is rechecked
before dispatch, rewrite and delivery; it is not inferred from reply revision alone.
The authenticated adapter asks the same tenant/Property execution policy as v1.

Same-key requests join only within an actor's running logical generation. The
request fingerprint binds tenant, Property, Review, source epoch/revision, base
reply revision, tone, concrete language, voice digest, contract and options; late
joins recheck current identity before receiving progress. The durable idempotency
scope includes actor for v2 only, preventing cross-manager key collisions. The
in-flight map retains promises and content-free progress/identity only while work
runs; completion removes the entry. No completed draft/result cache, table or new
content class exists. A browser owns its final result in memory. Cancelling or
aborting its response closes that browser's stream and drops future delivery;
the provider/settlement deadline is independent and the operation continues.
Each stream logs one content-free outcome (done/refused/deferred/cancelled),
contract, intent, duration and rewrite flag; unexpected failures log only error
name/code, with no exception message or draft content.
A later request cannot recover a completed result or cause same-key regeneration.
The two-second timer, session owner and reveal behavior belong to B3.

Re-verified map items 7–8 against origin/main `cf1e33c66` (B1 merged):

| Map item                                                | Current authority                                                                                                                                                                      |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7 — authenticated POST / cancellation                   | `src/contexts/ai/server/reply-suggestion-stream.ts:32`, `src/contexts/ai/server/reply-progress-stream.server.ts:16`                                                                    |
| 7 — safe incremental metadata / bounded provider stream | `src/shared/ai-provider-control/reply-progress-parser.ts:15`, `src/shared/ai-provider-control/bounded-event-stream.ts:2`, `src/shared/ai-provider-control/openai-stream-response.ts:7` |
| 7 — v2-only request attestation / deployment            | `src/shared/ai-openai-stream-profile.ts:32`, `src/shared/reply-drafting-v2-profile.ts:25`, `drizzle/0086_reply_drafting_progress.sql:1`                                                |
| 8 — lane / active actor ownership / identity            | `src/contexts/ai/application/reply-drafting-requests.ts:20`, `src/contexts/ai/infrastructure/adapters/ai-operation-store.adapter.ts:851`                                               |
| 8 — authoritative local/Google reply eligibility        | `src/contexts/review/infrastructure/repositories/unanswered-review.ts:11`                                                                                                              |

## Invariants

1. AI processes only currently eligible Google Review content loaded through the Review public source port plus the exact public Property display name loaded through Portal's narrow Brand authority. Brand image URLs, colors, localized content, Private Portal ratings, feedback, contact details, Inbox notes, manager-internal text, and Guest media never enter AI admission, prompts, outputs, logs, or derived tables.
2. Every operation is fenced by Organization, Property, source epoch, source revision, authorization epoch, capability epoch, policy/profile versions, model/deployment, idempotency key, and lifecycle generation.
3. Consent follows the notice, with explicit per-capability execution compatibility (ADR 0074); recorded runtime/deployment is historical evidence. Authorization is a maximum allowed capability set. A PropertyManager may operate only within the AccountAdmin-authorized set and current Property access; operating a feature never expands authorization.
4. Disable fences new and in-flight work immediately and hides outputs. Erasure purges local derivatives within the policy window while retaining only content-free evidence. Re-enable reuses an output only when every lineage, policy, model, authorization, and freshness fence still matches. An adopted Reply draft is Review-owned, so the control, Authorization and profile transitions withdraw the unedited ones in their own transaction through the AI draft purge (`src/shared/db/ai/ai-draft-purge.ts`; the rule is in the Review context's Model): a Reply nobody confirmed is deleted, and a confirmed one that has not been dispatched is cancelled and emptied while its publication authorization stays as evidence. A Reply whose publication already failed keeps its text, and Review's publish worker withdraws it the same way when a manager tries it again: its read of Google before the claim (an observation of the Review) withdraws it once the ten-minute adoption window has passed, and the claim refuses it when an input changed, claimed before or not.
5. Provider output is advisory. It cannot mutate Inbox status/assignment/escalation, publish a Reply, change Portal behavior, alter a Goal/Metric/Recognition result, or trigger workforce decisions. It starts no notification either, with one exception: an Urgent finding of review analysis v3 raises one content-free alert per review revision (`ai.review_analysis.urgent_detected`, below), and that alert changes nothing about the review (ADR 0031 and ADR 0046, amended 2026-10-30).
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

## Text-free draft measurement — live (B3a, 2026-10-31)

`application/reply-drafting-measurement.ts` observes both served contracts, once per
logical root request; the separately admitted rewrite remains a provider attempt.
The content-free recorder is `shared/db/ai/draft-generation-measurement.ts`.
Generation rows and Reply revision links are tenant-exportable and cascade from
operation metadata through a separate operation reference. Only Organization purge,
Property deletion and disabling or revoking Reply Drafting consent erase them.
Profile, binding, Review revisions and execution controls retain measurement metadata.
They grant no authorization and are never evidence of AI authorship.

Map item 10 was re-verified on stacked base `2add7d844`: adoption is at
`ai-suggested-draft-store.ts:378–513` (binary receipt 495–511); first save is at
`reply.repository.ts:580–597`; provenance clearing remains
`reply-write-guards.ts:159–170` and `reply-set-clause.ts:30–47`; submission is
`reply-operations.ts:529–568`; confirmed observation is
`google-reply-observation-store.ts:510–565`. The map itself starts item 10 at
line 383. Those are base references; this change adds measurement alongside them.

Other map-10 base references: the adoption columns in `ai.schema.ts` are now
271–276 (the map's 263–269 is stale), with their CHECK at 375; Reply AI fields
start at `review.schema.ts:836`, authorship CHECK at 919, and the provenance CHECK
is delegated at 932 to `reply-ai-provenance-check.ts:26`. Browser dismiss/adopt
start at `use-reply-suggestion.ts:251/256`, composer adoption/Undo/submit at
`use-reply-composer.ts:185/237/294`, and save/submit callbacks at
`use-reply-actions.ts:199/214`. The first-save clearing rule remains
`reply-ai-text.ts:65` and the write guard at `reply-write-guards.ts:168`.
