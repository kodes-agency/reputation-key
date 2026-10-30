# Guest voice 2.0: decisions

Date: 2026-10-30. Status: the owner's decisions of 2026-10-29 and the contract decisions built from them. Review analysis v3 (PR-3) shipped dark and was switched on on 2026-10-30 (the switch-on PR: `docs/operations/runbooks.md` section 32); the Guest voice page, the issue drawer, Inbox corrections, the Urgent alert and the Monday email (PR-4) read what it stores. The legal record of what is stored and why is the amendment of 2026-10-30 in [ADR 0031](../adr/0031-google-source-content-and-ai-processing-boundary.md). Paths are relative to the repository root.

## What Guest voice is for

A fix-first guide: what to fix first and what to protect, in guests' own words, ranked by stars at stake. It describes; managers act outside RepKey (no issue-level tasks or "being fixed" state). "Did a fix work" is read from each issue's 12-month chart and the falling or gone-quiet signal.

## The analysis (v3)

- **Topics.** Twelve universal topics for every kind of business: Staff and service, Speed and waiting, Booking and arrival, The main service, Food and drink, Cleanliness, Facilities and equipment, Price and billing, Atmosphere and noise, Location and access, Safety, Communication. Definitions, boundary rules and examples are in the prompt (`src/shared/review-analysis-v3-prompt.ts`). "No place types" holds.
- **Causes.** An open cause in a fixed shape (a thing and what was wrong or right), steered by vocabulary hints chosen silently from the Property's Google primary category. Hints are input data, so a new kind of business needs no re-analysis. Causes are grouped per Property into stable issues; managers can rename, merge and hide them.
- **Evidence.** Sentence pointers per topic and cause, and a per-mention flag "names a team member" or "names someone else". No name is stored.
- **Strength.** Mild, clear or strong instead of -100 to 100. Zero topics is allowed ("Ok").
- **Urgent.** Rare and explained: a reported risk to safety or health, discrimination, or a legal threat. Billing disputes, fraud accusations, rude staff and broken equipment are High. The reason is stored and shown. Urgent alone triggers an instant alert. The target is about 1% of reviews. A manager-set priority still wins (ADR 0071).
- **Providers.** The new notice names OpenAI and Anthropic. Nothing switches yet. v3 is built provider-neutral with server-side normalisation, because Claude's structured outputs do not enforce bounds. The test set picks the provider on measured quality.
- **Private portal feedback.** Stays out of the AI. Portal "what stood out" tags (no AI) come first.
- **Governance.** One new merchant notice version and a Privacy Notice row for Anthropic. No waiting period: both beta organizations are the owner's (2026-10-29). Every enabled Property re-consents, the epoch bumps and history is analysed again (about $5 to $17 on the beta).

## The numbers

- Per problem: "in 19 of 128 reviews with text, those average 2.1 stars, the rest 4.3, worth up to about 0.2 stars on your 90-day average" (share times gap over every review in the window, star-only reviews included). "Association, not proof." A Property's own reviews only; a small Property leans on its own 12-month history. Fix first ranks by it; Urgent overrides.
- The window is chosen automatically: the shortest of 30 days, 90 days, 6 months and 12 months that holds about 60 text reviews. It is named on the page and can be changed.
- Evidence levels: 3 or more reviews to enter Fix first; 1 or 2 on a quiet Watch list as counts; rising or falling only when at least 90% probable against the Property's own history; counts first, percentages above about 20 reviews; under about 10 text reviews in 12 months, "Not enough reviews yet to spot patterns" and the latest reviews.
- "Impact" is retired.

## The display

- Guest voice order: In short (three template lines from the analysis data, no extra AI call), Fix first, Guests love (and one neutral line "N reviews praise a team member by name", never a complaint version), What changed, Every topic. An Urgent strip in the rail. A link to the Google rating goal.
- Issue drawer: definition, 12-month chart, causes, live quotes with the evidence underlined (quotes that name a person are skipped), the reviews, "Not right?".
- Inbox: specific cause chips, the evidence sentence underlined, a filter by issue, and "Not right?" corrections that take effect at once. A correction is stored beside the kept AI answer, dropped on a new review revision, counted per topic to guide fixes, and never retrains anything.
- Guests' words appear in the app only, read live. Emails and reports carry topics, counts and links (ADR 0046 rule 8, ADR 0031).
- Monday email (opt-in): the same three lines, no quotes; none in a quiet week, a monthly roundup instead.

## The test set

About 400 synthetic items in English, Bulgarian and Spanish (hotels, restaurants, salons, spas, boat rentals, gyms, tour operators) that never expires, plus a live slice from the beta organizations (answers keyed to review IDs in a separate evaluation table, text read live, an item drops out when its review leaves Google). OpenAI and Claude pre-label, and the owner settles the disagreements. Until the new notice is in force, Claude sees only the synthetic core and the owner's own organization. The set is in `test-fixtures/review-analysis-v3/` and is scored by `pnpm eval:review-analysis-v3` (`scripts/evaluation/`).

## Contract decisions (2026-10-29)

These settle the open questions of the technical contract. Where the contract and this list differ, this list wins.

1. **Strength** is `mild`, `clear` or `strong` in data and gold labels. The UI says "mild", "clear", "strong". "Severe" is retired.
2. **Names** are flagged per mention. A quote is skipped on Guest voice when any mention citing that sentence carries `names_person`.
3. **Notice timing.** No waiting period for the merchant notice (owner, 2026-10-29: both beta organizations are the owner's). The merchant notice takes effect when PR-3 activates, and the owner re-consents both organizations right after. The public Privacy Notice row for Anthropic is published at once; Anthropic processes real reviews only after that notice's own published period.
4. **Provider and model** are chosen by the evaluation harness: exact dated snapshots, never a floating alias.
5. **Gold set.** 424 synthetic items exist (Codex 200, Claude 200, and 24 Bulgarian and Spanish Urgent and near-miss items written by Codex), labelled by both families (the 24 by Claude and Codex independently, the disagreements settled by the guide); the owner settles what remains. Gold v1.1 and annotation guide v3.3 (2026-10-30) make a generic word such as `place`, `staff` or `price` no `thing`. No licensed public data in v1 of the set (a licence would have to allow sending text to both providers).
6. **Release gates.** Urgent: zero misses on the gold set's safety and health cases, at least 95% recall overall, and no more than 2% of non-urgent gold items flagged Urgent. Topics: micro F1 at least 0.85 against gold, and no topic below 0.70 in a slice that holds at least 10 gold reviews of it. Causes: thing agreement at least 0.60 after the same normalisation of gold and answer. Every gate is reported per language (en, bg, es). Gates v2 (2026-10-30) moved the 0.70 thing agreement to 0.60 and added the 10-review floor; the reasons are in the 2026-10-30 amendment of ADR 0031, part (b). As built, thing agreement is the share of all the mentions either side made that are a pair agreeing on the thing: a cause only the gold has, or only the answer has, counts against it, so an answer cannot score 1 by returning only the causes it is sure of. The decision did not say how misses count; the owner confirms this reading or sets another before a provider is chosen on it.
7. **Fallback** is operator-only switching between providers with an epoch re-run; there is no automatic per-call fallback (the operation ledger cannot express it safely).
8. **Attention formula v2.** Urgent as the guide defines it; High is any clear or strong complaint mention, or a rating of 1 or 2 unless the sentiment is positive; Medium is mixed sentiment or only mild complaints; Low otherwise. As built (`deriveReviewAttentionV2`, `src/shared/review-analysis-v3.ts`), negative sentiment also makes it Medium, so a negative review of 3 or more stars with no complaint mention is Medium, not Low; the owner confirms.
9. **Cause legality.** `thing` (at most 3 words) is a generic noun phrase and may appear verbatim in the review, an object's name like today's single-word labels; `issue` (at most 3 words) likewise. The anti-quotation guard refuses a cause when `thing` and `issue` together reproduce four or more contiguous words of the review. Proper nouns, names and brands are refused as today.
10. **Urgent alert.** It reuses the existing urgent notification channel and preferences (in-app and email). Recipients are the managers who receive this Property's review notifications. There is one alert per review revision. The email says "An urgent review needs you" with a link and no reason or review text (ADR 0046 rule 8); the reason shows in the app. `docs/BETA.md` §3 and AI invariant 5 allow exactly this one AI-triggered message.
11. **Monday email.** A separate opt-in preference, Mondays 08:00 Property-local. A quiet week is no change in Fix first, no new issue and no Urgent review, and sends nothing. A monthly roundup on the first Monday of the month always sends. Recipients are managers with Guest voice access who opted in.
12. **Primary category.** Refreshed automatically from Google; it is only a hint, never shown as a venue type. As built (migration 0078), it is read when a location is imported or relinked, with no background refresh between them; the owner accepts this or asks for a refresh in the location-metadata sync.
13. **Star-only denominator.** Daily rating-bucket counts (how many 1 to 5 star reviews a day, no review identity) are the derivative.
14. **Correction rate** is corrections divided by all analysed mentions of that topic.
15. **Issue grouping** is deterministic normalisation plus manager merges only; no model clustering.
16. **Retention.** PR-3 ships a tested 24-month deletion sweep covering every new table; nothing new goes active without it.
17. **Workforce boundary.** Named-staff praise stays one Property-level line: no names, no complaint version, no per-person counts, no ranking.
18. **Legacy trends.** The v1 trend schedules and daily aggregate tables retire in PR-4's cleanup, once "What changed" runs on the statistics engine.
19. **Performance.** Measure on the 128-review fixture and a 20,000-review scale fixture before adding any materialised projection.
20. **Activation.** The owner re-consents. The release lead runs the activation deploy, watches re-analysis cost and coverage, holds the kill switch and writes the runbook entry.
