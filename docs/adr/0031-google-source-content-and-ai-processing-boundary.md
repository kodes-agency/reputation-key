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
