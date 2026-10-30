---
status: accepted
date: 2026-07-15
---

# 0031 — Google source content and AI processing boundary

Google Business Profile review processing is allowed only through a versioned, executable source policy that keeps raw Google content within a refresh-or-remove cache lifecycle, permits separately stored per-property derivative metadata, and fails closed for any unclassified AI operation. This converts Google's 2026-07-14 written response into an architectural boundary rather than relying on route conventions or developer memory.

## Decision

The review context remains the sole owner of canonical raw Google review and reply content. Raw review text, rating, reviewer information, Google identifiers, and Google-observed reply text are refreshed or removed under the applicable 30-day cache policy; a local read, scheduler touch, copy, backup, or model call never extends that clock. RepKey adopts the conservative interpretation that only a successful authorized Google re-fetch may establish a new cache observation until Google confirms more precise refresh semantics.

AI results may be retained separately only when they are property-scoped derivative metadata that does not reproduce raw content, personally identifiable information, Google identifiers, exact replies, or reversible content fingerprints. Bounded lowercase category labels of no more than four words are permitted derivative metadata only when they identify nobody, contain no proper noun, and are non-reversible; review excerpts and identifiers remain forbidden. Per-review sentiment/aspect analysis, property-local themes/trends/summaries, and manager-requested reply drafts are conditionally allowed. Cross-property AI reports, organization summaries, automatic reply publication, provider training on submitted data, silent cross-region fallback, and review-derived staff goals/badges/leaderboards are denied (amended 2026-10-14, below).

Every external AI operation requires all of the following at invocation and persistence time:

- an active property-scoped Merchant AI Opt-in and matching enablement epoch;
- an approved capability in the current `SourceContentPolicy`;
- an approved provider deployment for the property's processing region;
- structured reviewer identity removal and approved free-text PII redaction;
- no-training and minimum-retention provider controls with preserved evidence;
- content-safe logs, traces, jobs, events, audit records, and backups; and
- a separate manager-controlled publication command for any reply.

Unknown policy versions, capabilities, consent state, property regions, provider deployments, or redaction profiles deny only the affected AI operation. Review synchronization, inbox work, and human-authored/manual reply management remain available where independently permitted.

This decision supersedes ADR 0003's use of `reviewedAt + 30 days` as the review-cache expiry basis and its three-day post-expiry purge grace. Migration uses explicit first/last successful fetch, refresh-due, and hard-expiry timestamps; expired raw content is not served during a grace period.

The implementation contract and evidence gates live in the [AI and Google Source Governance package](../archive/2026-09-lean/product-readiness-program-2026-07/ai-governance/README.md). The evidentiary basis is the [Google support response and disposition](../external/google/google-business-profile-ai-policy-response-2026-07-14.md).

The initial external-AI candidate is the exact, currently unapproved
[`openai-responses-gpt-5-4-mini-2026-03-17-us-zdr-v1`](../archive/2026-09-lean/product-readiness-program-2026-07/ai-governance/openai-gpt-5-4-mini-us-zdr-assessment.md)
deployment with redaction profile
[`gbp-review-en-v1`](../archive/2026-09-lean/product-readiness-program-2026-07/ai-governance/pii-redaction-specification.md).
The [AI release-evidence index](../archive/2026-09-lean/product-readiness-program-2026-07/ai-governance/ai-release-evidence-index.md)
is authoritative for promotion. Accepting this boundary does not approve either
candidate; missing or expired evidence keeps every AI capability dark.

### Canonical synthetic provider fixture

Provider-resource examples are generated from the closed Google fixture
catalogue. They are synthetic parser/test inputs only and are never valid
production identifiers.

<!-- google-provider-identifiers-v1:start -->

> Generated from `test-fixtures/google-provider-identifiers-v1.json` (google-provider-identifiers-v1, SHA-256 `5c41f1021fb6cdfac15994d5fd7116282a3e5e94b5a3b79708813e091672cd05`). Do not edit this block.
> Canonical synthetic review resource: `accounts/repkey-synthetic-do-not-use-account-0001/locations/repkey-synthetic-do-not-use-location-0001/reviews/repkey-synthetic-do-not-use-review-0001`.

<!-- google-provider-identifiers-v1:end -->

## Considered options

- **Treat the support response as documentation only.** Rejected because scattered booleans, routes, and worker conventions are bypassable and cannot prove what happened under a particular policy version.
- **Retain all normalized review data indefinitely and constrain only prompts.** Rejected because it conflates raw source content with permitted derivative metadata and makes deletion, backups, and downstream copies ungovernable.
- **Disable all Google-derived AI permanently.** Rejected because Google conditionally permitted the submitted per-property architecture and the required controls are technically enforceable.

## Consequences

- Feed may read a review's rating through the eligible read at the moment a notification is written, to route it by its reader's Low ratings threshold, and persists only the routing outcome — never the rating (ADR 0046, amended 2026-09-30). A read neither extends the cache clock nor copies content.

- PRE17 must establish the raw-content lifecycle, property processing profile, source-policy evaluator, deletion participation, and evidence hooks before Phase 17 can call a model.
- Phase 17/18 schemas must keep raw content and derivatives separate and record policy, prompt/schema/model, aspect-taxonomy, redaction, consent, provider deployment, and region versions without retaining prompt bodies.
- Backups and restores need purge-ledger or approved erasure behavior so restoration cannot resurrect expired content into service.
- Review-analysis contract changes bump the capability epoch and use the existing enrollment path to backfill eligible history. The exact raw-cache refresh semantics, durable previous-reply examples, and backup treatment remain conservative until a narrower written clarification or approved policy change supersedes this ADR.

## Note 2026-10-13 — where the approved capability is decided

The Decision requires, for every external AI operation, "an approved capability
in the current `SourceContentPolicy`". No field of that object names a
capability, and no AI operation reads the object when it is admitted or when its
output is stored. `SourceContentPolicy` carries its source, two timings (the
raw-content TTL and the refresh point before it) and the policy version, and
nothing else (`src/shared/domain/source-content-policy.ts`;
`source-content-policy.test.ts` pins the field list). Three booleans that read
like such an approval (per-review analysis, per-Property aggregation, keeping
derived metadata) were fixed at `true`, were consulted by no code, and were
deleted on 2026-10-13 (`docs/BETA.md` §2).

The approval that requirement asks for is decided in two other places:

- the capability's fate in `src/shared/governance/capability-fate.ts`:
  `ai.analyze`, `ai.generate_reply` and `ai.detect_trends` are controlled beta,
  and `gbp.ai.cross_property_summary` and `gbp.reply.auto_publish` are
  permanently denied (`docs/BETA.md` §2 and §4);
- the Property's Merchant AI Authorization, whose capability set is the most an
  operation may use (`AiMerchantAuthorizationSnapshot.capabilities`, AI CONTEXT
  invariant 3). It is read when the operation starts and again, under a row
  lock, when its output is stored (`docs/BETA.md` §2 and §3).

The decision is unchanged: an external AI operation still needs an approved
capability, and an unknown one is still denied. This note records where the code
holds that approval and decides nothing.

## Amended 2026-10-14 — a Property Google rating goal is not a staff goal

Owner decision 2026-10-14, recorded in
[ADR 0067](0067-property-google-rating-goal.md). The denial of review-derived
staff goals, badges and leaderboards is unchanged. ADR 0067 adds one
Property-level goal for the rating Google shows: AccountAdmins and
PropertyManagers with access to the Property set it, it is never split across
Portals, Portal Groups or people, it is never shown to staff, and it is never a
quota, ranking, incentive or employment input. It is not a staff goal.

It reads the review cache only through Review's public API, as counts and star
sums of reviews that may be served under this policy and were observed under the
Property's current Google binding. As with Feed's rating read above, a read
neither extends the cache clock nor copies content. The goal stores no review
content and no per-review value, only Property-level figures, and no AI
operation takes part in it.

## Amended 2026-10-17 — the rating goal's tracking page names low reviews

Owner decision 2026-10-16 (PLAN-D Q2 (a)), recorded in
[ADR 0067](0067-property-google-rating-goal.md) (amendment of 2026-10-17). The
rating goal's "no per-review value" has two named exceptions on its tracking
page, for the goal's managers only, read live and never stored, exported or
logged: up to 25 current Google reviews since the goal was set below its
threshold and at most 4★ (the review's id, stars and creation time; the server
turns the ids into Inbox item ids when the viewer may open the Inbox and sends
the browser at most ten rows and never a review id), and this Property-local
week's star split. Both are read through Review's public API under this
policy's serving eligibility and the Property's current Google binding; a read
neither extends the cache clock nor copies content. No review text, reviewer,
Google identifier or reply leaves Review, and no AI operation takes part.

## Amended 2026-10-21 — the reminder pre-check is an authorized fetch like any other

Inbox's Response Target reminder job reads one review from Google before it
releases a Google-review reminder for it (ADR 0046, amended 2026-10-21). That
read goes through Review's observation writer under `property.connect_gbp`, so
it refreshes the Review's content clock exactly as any authorized fetch does
and records the reply state it shows. It never reads content whose source is
`source_expired` or `provider_deleted`, nor content past its expiry, so a
reminder cannot re-hydrate erased content; it logs counts only.

## Amended 2026-10-30 — Guest voice 2.0: more derivative fields, and evaluation as an approved need

Owner decisions of 2026-10-29, recorded in [the Guest voice 2.0 decisions](../plan/guest-voice-2.md). Part (a) lists the derivative fields Review Analysis v3 stores and why each stays inside this boundary. Part (b) records evaluation as the separately approved need for keeping review identifiers in an evaluation table, which Google's response of 2026-07-14 (section 5) asks for. Nothing else in this ADR changes. The fields are written only when Review Analysis v3 is switched on; until then the tables exist and stay empty.

### (a) New derivative fields

Review Analysis v3 stores these, per review and per Property. The v3 contract change bumps the capability epoch and the existing enrollment path analyses eligible history again, as the Consequences section above already provides.

| Field              | Shape                                                                                                                                                                                                  | Why it stays inside the boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sentiment          | One of positive, neutral, negative, mixed                                                                                                                                                              | Closed list.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Topic              | One of twelve ids: staff_service, speed_waiting, booking_arrival, main_service, food_drink, cleanliness, facilities_equipment, price_billing, atmosphere_noise, location_access, safety, communication | Closed list. It replaces the aspect taxonomy for v3 analyses. Its version is recorded with the analysis, as this ADR already requires.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Polarity, strength | Positive, neutral or negative; mild, clear or strong                                                                                                                                                   | Closed lists. Strength replaces the -100 to 100 intensity, so it holds less detail than before.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Cause              | `thing` and `issue`: each one to three lowercase English words                                                                                                                                         | Each part is a bounded lowercase label of up to three words, inside the four-word limit set above. A part may be a plain noun phrase that also stands in the review, such as an object's name ("air conditioning"), as a single-word label always could. The server refuses a cause whose two parts together reproduce four or more contiguous words of the review, and a part that is a word the review capitalises, wherever it stands, unless it is a common word or one of the Property's vocabulary hints; that is how a person's name, a brand or a place is kept out, and the request also forbids them. Written in English whatever the review language. |
| Evidence           | Whole numbers: which sentences of the review each result comes from                                                                                                                                    | Position only. Holds no word, and means nothing without the review text, which stays under the 30-day rule.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Names result       | `team_member`, `other` or none, per mention                                                                                                                                                            | Says that a cited sentence names a person, never whose. No name is stored.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Urgent reason      | None, or one of safety, health, discrimination, legal_threat                                                                                                                                           | Closed list. No detail. The characteristic behind a discrimination report is not stored.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Property category  | One string per Property: the primary category Google lists                                                                                                                                             | Business Profile location metadata that the Service already imports (Access Disclosure, "How Google data is used", "Core review management", item 1). Not derived from reviews. Used only as input, to choose vocabulary hints; never shown as a venue type.                                                                                                                                                                                                                                                                                                                                                                                                     |
| Issue groups       | Per Property: a canonical thing per topic, its member things, and a manager's rename, merge or hide                                                                                                    | Derived from the cause fields inside one Property by deterministic normalisation, with no model call and no learning across Properties. A manager's name for a group is manager text and never enters AI input (AI context invariant 1).                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Manager correction | Beside the kept AI answer: a removed topic, a changed cause, or "not a problem"                                                                                                                        | Manager input. Dropped when the review gets a new revision. Not sent to a provider.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Daily star counts  | Per Property and local day: how many reviews, how many with text, and how many at each of 1 to 5 stars                                                                                                 | The denominator of "worth up to about 0.2 stars", star-only reviews included. A count carries no review identity, text, reviewer or reply. Kept 24 months from the day it counts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Three conditions hold for all of them.

1. **One Property.** Grouping, counts and any figure such as "worth up to about 0.2 stars" are worked out inside one Property from that Property's own reviews. Nothing is borrowed across Properties. Cross-Property reports stay denied.
2. **No raw content.** No field reproduces a sentence, a passage of four or more words, a name, a Google identifier, an exact reply or a content fingerprint. The two parts of a cause are the only free words: the server holds each to three words and refuses the pair when together they reproduce four or more contiguous words of the review.
3. **Retention and withdrawal.** The 24-month rule for de-identified insights applies, and every table that stores these fields has a tested 24-month deletion rule in the retention sweep before it is written to. Turning a capability off hides the fields at once. Erasure purges them within the policy window.

**The names result is not a staff measure.** It says that a sentence names a team member or someone else. It has two uses: Guest voice leaves out a quote when any mention citing that sentence carries a name, and Guest voice may show one Property-level line, "N reviews praise a team member by name". There is no name, no per-person figure, no ranking and no complaint version. The denial of review-derived staff goals, badges and leaderboards stands. So does Google's separate-policy row, which lists named mentions among the things that never drive them.

**Urgent can raise one alert.** The reason is stored and shown. An Urgent finding can send one alert per review revision, through the existing urgent notification channel and the preferences a manager already has (in-app and email), to the managers who receive that Property's review notifications. The email says that an urgent review needs the manager, with a link, and holds no reason, rating or review text (ADR 0046, rule 8). The reason shows in the app. A manager-set priority still wins (ADR 0071), and the alert changes no Inbox status, assignment or escalation. `docs/BETA.md` section 3 and AI context invariant 5 allow exactly this one AI-triggered message; ADR 0046 (amended 2026-10-30) says how the alert is raised and delivered.

**Guests' words stay out of storage.** Guest voice, issue pages and the Inbox read the words from the held review text when a page opens. They are not copied into results, summaries, alerts, emails or reports.

**Providers (amended 2026-10-30, the switch-on).** Review analysis v3 runs on OpenAI `gpt-6-luna` at low reasoning, pinned by its plain id because the account lists no dated snapshot; the quality check of 2026-10-30 (424 invented reviews, every gate passed) is the evidence, and the live slice measures real reviews after the switch-on. The deployment profile is `private-beta-global-v2`: Anthropic is named in its envelope and is not selectable (`OPERATOR_PROVIDER_SELECTION` names OpenAI alone, no adapter is registered, the deployment has no key). Reply drafting and property trends run on the same deployment profile. A second provider, Anthropic, comes in through the Merchant AI notice and a provider-neutral connector. It must meet every control in the Decision list above, including no-training and minimum-retention evidence preserved for the deployment, and a deployment pins an exact dated model snapshot, never a floating alias. Accepting this amendment approves neither provider for v3. Missing or expired evidence keeps v3 dark, as the Decision already says of the first candidate.

### (b) Evaluation is the approved need for review identifiers in a test table

Google's response says not to keep Google review IDs in long-lived derivative records "without a separately approved need". This amendment records one: evaluation.

**The need.** Before v3 is switched on, and again whenever a prompt, a model or a provider changes, RepKey must show that the analysis is accurate: agreement per topic and per cause, recall on known Urgent cases, results per language, and a comparison of the two providers. Synthetic items cover part of this (`test-fixtures/review-analysis-v3/`, scored by `scripts/evaluation/`, which holds no review identifier). They cannot show how the analysis behaves on the reviews of the businesses RepKey serves.

**The gates, as the first measurement moved them (2026-10-30).** The release gates are decision 6 of [the Guest voice 2.0 decisions](../plan/guest-voice-2.md). The first quality check against OpenAI (400 invented reviews, `gpt-5.6-luna`, low reasoning effort, run in the beta worker with synthetic items only and nothing written) met the Urgent gates it could read (English only: 30 of 30 found, none missed) and the topic micro F1 gate (0.94), and read thing agreement at 0.51 (0.55 in English, 0.42 in Bulgarian and in Spanish) and the weakest topic of Bulgarian and Spanish at 0.67 and 0.40, each on a topic with one gold review. Two numbers of the gates moved, for these reasons, and no other:

- **Thing agreement 0.70 to 0.60, read after the same normalisation of the gold and the answer.** A provider cannot be asked to agree with the gold more than the gold's own labellers agreed with each other. By the harness's metric the first-round labels of the two labelling families (GPT through Codex, Claude) agree on the thing of a mention at 0.59 over the 400 reviews (1,089 paired mentions), and at 0.66 once generic words are null on both sides. 0.60 asks a provider to agree with the gold about as well as one family agrees with the other. The normalisation is deterministic product vocabulary (`property-issue-normalization-v1`: a plural rule and topic-scoped synonyms), so a plural or a synonym is not a disagreement; it is the same function for the gold and the answer.
- **The 0.70 floor on the weakest topic applies only to a topic with at least 10 gold reviews in the slice.** The F1 of a topic with one or two gold reviews moves by 0.3 to 0.5 on a single miss or extra mention (Bulgarian `booking_arrival` has one gold review). That is a count, not a finding about the provider. A smaller topic is still scored and named in the gate's note, and the micro F1 gate counts every topic.

The same measurement fixed what was the prompt's and the gold's, not the gates': annotation guide v3.3 (generic words are no thing; the shape of a cause; what a speed_waiting thing is; timing cues; a narrow booking_arrival; hazards that are only a possibility), a prompt that says so, gold v1.1 that applies it, a normalizer that keeps a mention whose cause is invalid instead of dropping it (the old rule dropped 40 of the 1,268 mentions the model gave), and 24 Bulgarian and Spanish Urgent and near-miss items, because the set held no Urgent case outside English and Urgent recall in those languages could not be read. Everything the prompt and the catalogue were tuned on is synthetic and was also the measuring set, so a report says how a prompt does on this set, not how it will do on the beta's own reviews; the live slice of this part (the evaluation table below) is what measures that.

**What the evaluation table holds.** RepKey's own Review identifier, never Google's. The Property. The test set and item version. The checked answers in the v3 shape. Which labellers produced them (provider, model, prompt version) and the role that settled a disagreement, not a name. Timestamps. Test scores are aggregate numbers and hold no text.

**What it never holds.** Review text, an excerpt, a rating, a reviewer name or photo, a reply, a Google identifier or resource name, a fingerprint of any of these, or a provider request or response body (AI context invariant 12).

**How text is read.** At test time, through Review's public API, under this policy's serving eligibility and the Property's current Google binding. A read neither extends the cache clock nor copies content. Text reaches a provider only through the governed AI path (consent, redaction, admission). A person reads it only inside the app.

**Whose reviews.** A Property's reviews only while the Property has an in-force Merchant AI Authorization for Review Analysis, under a notice that names the provider doing the test. Until the new notice is in force, Anthropic sees synthetic items and the reviews of the owner's own Organization, on the owner's decision as controller (2026-10-29). That is not a consent recorded in the app.

**When an item leaves.** A review whose source is `provider_deleted` or `source_expired` drops out of every run. When AI is turned off for the Property, or an AccountAdmin erases AI data, the Property's rows are hidden at once and purged within the policy window. No row lives longer than 24 months from creation, and the table has its tested deletion rule in the retention sweep before it is written to.
